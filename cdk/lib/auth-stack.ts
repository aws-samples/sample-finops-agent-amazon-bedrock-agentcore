import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface AuthStackProps extends cdk.StackProps {
  adminEmail: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;
  public readonly identityPoolId: string;
  public readonly userPoolArn: string;
  public readonly userPoolProviderName: string;
  public readonly oauthClientId: string;
  public readonly oauthTokenEndpoint: string;
  public readonly oauthAuthorizationEndpoint: string;
  public readonly oauthIssuer: string;
  public readonly oauthProviderName: string;
  public readonly oauthProviderArn: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // ========================================
    // Cognito User Pool
    // ========================================

    const userPool = new cognito.UserPool(this, 'FinOpsUserPool', {
      userPoolName: `${this.stackName}-users`,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
        username: true,
      },
      autoVerify: {
        email: true,
      },
      userInvitation: {
        emailSubject: 'Your FinOps Agent Login Credentials',
        emailBody: [
          '<h2>Welcome to FinOps Agent</h2>',
          '<p>Your admin account has been created. You will be prompted to change your password on first login.</p>',
          '<br/>',
          '<p><strong>Username</strong></p>',
          '<p style="font-family: monospace; font-size: 16px; background: #f0f0f0; padding: 8px; display: inline-block;">{username}</p>',
          '<br/>',
          '<p><strong>Temporary Password</strong></p>',
          '<p style="font-family: monospace; font-size: 16px; background: #f0f0f0; padding: 8px; display: inline-block;">{####}</p>',
        ].join('\n'),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true, // Add symbol requirement for stronger security
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolId = userPool.userPoolId;
    this.userPoolArn = userPool.userPoolArn;
    this.userPoolProviderName = userPool.userPoolProviderName;

    // Add Cognito Domain for OAuth
    const userPoolDomain = userPool.addDomain('FinOpsDomain', {
      cognitoDomain: {
        domainPrefix: `finops-mcp-${this.account}-${cdk.Names.uniqueId(this).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 8)}`,
      },
    });

    // OAuth endpoints for Gateway and AgentCore Identity
    const domainUrl = `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;
    this.oauthTokenEndpoint = `${domainUrl}/oauth2/token`;
    this.oauthAuthorizationEndpoint = `${domainUrl}/oauth2/authorize`;
    this.oauthIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    // ========================================
    // User Pool Clients
    // ========================================

    // Create Resource Server for M2M authentication (required for client_credentials flow)
    const mcpInvokeScope: cognito.ResourceServerScope = {
      scopeName: 'invoke',
      scopeDescription: 'Invoke MCP runtime tools',
    };

    const resourceServer = userPool.addResourceServer('FinOpsResourceServer', {
      identifier: 'mcp-runtime-server',
      userPoolResourceServerName: `${this.stackName}-resource-server`,
      scopes: [mcpInvokeScope],
    });

    // Client for frontend users (no secret)
    const userPoolClient = userPool.addClient('FinOpsUserPoolClient', {
      userPoolClientName: `${this.stackName}-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
      },
    });

    this.userPoolClientId = userPoolClient.userPoolClientId;

    // M2M Client for Gateway → MCP Server Runtimes (with secret for client credentials flow)
    const m2mClient = userPool.addClient('FinOpsM2MClient', {
      userPoolClientName: `${this.stackName}-m2m-client`,
      generateSecret: true,
      authFlows: {
        userPassword: false,
        userSrp: false,
        custom: false,
      },
      oAuth: {
        flows: {
          clientCredentials: true, // M2M flow
        },
        scopes: [
          cognito.OAuthScope.resourceServer(resourceServer, mcpInvokeScope),
        ],
      },
    });

    this.oauthClientId = m2mClient.userPoolClientId;

    // ========================================
    // Identity Pool
    // ========================================

    const identityPool = new cognito.CfnIdentityPool(this, 'FinOpsIdentityPool', {
      identityPoolName: `${this.stackName.replace(/[^a-zA-Z0-9]/g, '_')}_identity_pool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
        {
          clientId: m2mClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    this.identityPoolId = identityPool.ref;

    // ========================================
    // IAM Roles for Identity Pool
    // ========================================

    // Authenticated Role - Can invoke Main Agent Runtime
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      roleName: `${this.stackName}-authenticated-role`,
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Note: Runtime ARN will be added after AgentStack is deployed
    // Frontend users will invoke the main agent runtime via IAM
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:InvokeAgentRuntime',
        'bedrock-agentcore:GetRuntime',
        'bedrock-agentcore:ListRuntimes',
      ],
      resources: [
        `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/finops_billing_mcp*`,
        `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/finops_pricing_mcp*`,
        `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/finops_runtime*`,
      ],
    }));

    // Unauthenticated Role - Deny all
    const unauthenticatedRole = new iam.Role(this, 'UnauthenticatedRole', {
      roleName: `${this.stackName}-unauthenticated-role`,
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'unauthenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    unauthenticatedRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['*'],
      resources: ['*'],
    }));

    // Attach roles to Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
        unauthenticated: unauthenticatedRole.roleArn,
      },
    });

    // ========================================
    // Admin User
    // ========================================

    new cognito.CfnUserPoolUser(this, 'AdminUser', {
      userPoolId: userPool.userPoolId,
      username: 'admin',
      userAttributes: [
        {
          name: 'email',
          value: props.adminEmail,
        },
        {
          name: 'email_verified',
          value: 'true',
        },
      ],
      desiredDeliveryMediums: ['EMAIL'],
    });

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${this.stackName}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${this.stackName}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPoolId,
      description: 'Cognito Identity Pool ID',
      exportName: `${this.stackName}-IdentityPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: `${this.stackName}-UserPoolArn`,
    });

    new cdk.CfnOutput(this, 'OAuthClientId', {
      value: this.oauthClientId,
      description: 'OAuth Client ID for Gateway',
      exportName: `${this.stackName}-OAuthClientId`,
    });

    new cdk.CfnOutput(this, 'OAuthTokenEndpoint', {
      value: this.oauthTokenEndpoint,
      description: 'OAuth Token Endpoint for Gateway',
      exportName: `${this.stackName}-OAuthTokenEndpoint`,
    });

    new cdk.CfnOutput(this, 'OAuthAuthorizationEndpoint', {
      value: this.oauthAuthorizationEndpoint,
      description: 'OAuth Authorization Endpoint',
      exportName: `${this.stackName}-OAuthAuthorizationEndpoint`,
    });

    new cdk.CfnOutput(this, 'OAuthIssuer', {
      value: this.oauthIssuer,
      description: 'OAuth Issuer URL',
      exportName: `${this.stackName}-OAuthIssuer`,
    });

    new cdk.CfnOutput(this, 'OAuthDiscoveryUrl', {
      value: `${this.oauthIssuer}/.well-known/openid-configuration`,
      description: 'OAuth Discovery URL for M2M authentication',
      exportName: `${this.stackName}-OAuthDiscoveryUrl`,
    });

    new cdk.CfnOutput(this, 'AuthenticatedRoleArn', {
      value: authenticatedRole.roleArn,
      description: 'Authenticated Role ARN',
    });

    new cdk.CfnOutput(this, 'AdminEmail', {
      value: props.adminEmail,
      description: 'Admin user email (temporary password sent via email)',
    });

    new cdk.CfnOutput(this, 'AdminUsername', {
      value: 'admin',
      description: 'Admin username',
    });

    // ========================================
    // OAuth Provider - Created by external Python script after stack deploy
    // ========================================

    this.oauthProviderName = 'finops-mcp-oauth-provider';
    this.oauthProviderArn = 'CREATED_BY_SCRIPT'; // Will be read from oauth-provider-arn.txt

    new cdk.CfnOutput(this, 'OAuthProviderName', {
      value: this.oauthProviderName,
      description: 'OAuth Provider Name (created by scripts/create-oauth-provider.py)',
    });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================

    // Cognito User Pool suppressions
    NagSuppressions.addResourceSuppressions(userPool, [
      {
        id: 'AwsSolutions-COG2',
        reason: 'MFA not enforced for demo/development environment. Production deployments should enable MFA for enhanced security.',
      },
      {
        id: 'AwsSolutions-COG3',
        reason: 'Advanced security features (compromised credentials check) not required for demo/development environment. Production deployments should enable AdvancedSecurityMode.',
      },
    ], true);

    // Authenticated Role suppressions
    NagSuppressions.addResourceSuppressions(authenticatedRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard required for AgentCore runtime invocation to support all session IDs and conversation turns (runtime ARN with /* suffix)',
      },
    ], true);



    // Stack-level suppressions for CDK-created Lambda functions (Cognito domain custom resource)
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions created by CDK for Cognito domain custom resource',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Lambda function is created and managed by CDK for Cognito domain custom resource - runtime is automatically updated by CDK',
      },
    ]);
  }
}
