import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface AuthStackProps extends cdk.StackProps {
  runtimeArn: string;
  adminEmail: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;
  public readonly identityPoolId: string;

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

    // ========================================
    // User Pool Client
    // ========================================

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
      ],
    });

    this.identityPoolId = identityPool.ref;

    // ========================================
    // IAM Roles for Identity Pool
    // ========================================

    // Authenticated Role - Can invoke Agent Runtime
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

    // Grant permission to invoke Agent Runtime
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:InvokeAgentRuntime',
        'bedrock-agentcore:GetRuntime',
        'bedrock-agentcore:ListRuntimes',
      ],
      resources: [
        props.runtimeArn,
        `${props.runtimeArn}/*`,
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
  }
}
