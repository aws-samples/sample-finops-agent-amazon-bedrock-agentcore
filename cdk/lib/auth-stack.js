"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const cdk_nag_1 = require("cdk-nag");
class AuthStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        const mcpInvokeScope = {
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
        this.oauthClientSecret = m2mClient.userPoolClientSecret;
        // Store M2M OAuth credentials in Secrets Manager for Gateway
        this.oauthCredentialsSecret = new secretsmanager.Secret(this, 'OAuthCredentialsSecret', {
            secretName: `${this.stackName}-oauth-credentials`,
            description: 'M2M OAuth client credentials for AgentCore Gateway',
            secretObjectValue: {
                clientId: cdk.SecretValue.unsafePlainText(m2mClient.userPoolClientId),
                clientSecret: m2mClient.userPoolClientSecret,
            },
        });
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
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                StringEquals: {
                    'cognito-identity.amazonaws.com:aud': identityPool.ref,
                },
                'ForAnyValue:StringLike': {
                    'cognito-identity.amazonaws.com:amr': 'authenticated',
                },
            }, 'sts:AssumeRoleWithWebIdentity'),
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
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                StringEquals: {
                    'cognito-identity.amazonaws.com:aud': identityPool.ref,
                },
                'ForAnyValue:StringLike': {
                    'cognito-identity.amazonaws.com:amr': 'unauthenticated',
                },
            }, 'sts:AssumeRoleWithWebIdentity'),
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
        new cdk.CfnOutput(this, 'OAuthCredentialsSecretArn', {
            value: this.oauthCredentialsSecret.secretArn,
            description: 'OAuth Credentials Secret ARN',
            exportName: `${this.stackName}-OAuthCredentialsSecretArn`,
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
        cdk_nag_1.NagSuppressions.addResourceSuppressions(userPool, [
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
        cdk_nag_1.NagSuppressions.addResourceSuppressions(authenticatedRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard required for AgentCore runtime invocation to support all session IDs and conversation turns (runtime ARN with /* suffix)',
            },
        ], true);
        // OAuth Credentials Secret suppression
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.oauthCredentialsSecret, [
            {
                id: 'AwsSolutions-SMG4',
                reason: 'OAuth client credentials do not require automatic rotation - they are managed by Cognito and can be manually rotated if needed',
            },
        ], true);
        // Stack-level suppressions for CDK-created Lambda functions (Cognito domain custom resource)
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
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
exports.AuthStack = AuthStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGgtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLGlFQUFtRDtBQUNuRCx5REFBMkM7QUFFM0MsK0VBQWlFO0FBRWpFLHFDQUEwQztBQU0xQyxNQUFhLFNBQVUsU0FBUSxHQUFHLENBQUMsS0FBSztJQWV0QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXFCO1FBQzdELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDJDQUEyQztRQUMzQyxvQkFBb0I7UUFDcEIsMkNBQTJDO1FBRTNDLE1BQU0sUUFBUSxHQUFHLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDNUQsWUFBWSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsUUFBUTtZQUN2QyxpQkFBaUIsRUFBRSxLQUFLO1lBQ3hCLGFBQWEsRUFBRTtnQkFDYixLQUFLLEVBQUUsSUFBSTtnQkFDWCxRQUFRLEVBQUUsSUFBSTthQUNmO1lBQ0QsVUFBVSxFQUFFO2dCQUNWLEtBQUssRUFBRSxJQUFJO2FBQ1o7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLENBQUM7Z0JBQ1osZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLGNBQWMsRUFBRSxJQUFJLEVBQUUsK0NBQStDO2FBQ3RFO1lBQ0QsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVTtZQUNuRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxVQUFVLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQztRQUN0QyxJQUFJ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Q3ZCLE1BQU0sRUFBRSxnSUFBZ0k7YUFDekk7U0FDRixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQsNkZBQTZGO1FBQzdGLHlCQUFlLENBQUMsb0JBQW9CLENBQUMsSUFBSSxFQUFFO1lBQ3pDO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSx3SUFBd0k7Z0JBQ2hKLFNBQVMsRUFBRSxDQUFDLHVGQUF1RixDQUFDO2FBQ3JHO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLGlCQUFpQjtnQkFDckIsTUFBTSxFQUFFLDRIQUE0SDthQUNySTtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTVYRCw4QkE0WEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcblxuZXhwb3J0IGludGVyZmFjZSBBdXRoU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgYWRtaW5FbWFpbDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQXV0aFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sSWQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sQ2xpZW50SWQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IGlkZW50aXR5UG9vbElkOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbEFybjogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlclBvb2xQcm92aWRlck5hbWU6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoQ2xpZW50SWQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoQ2xpZW50U2VjcmV0OiBjZGsuU2VjcmV0VmFsdWU7XG4gIHB1YmxpYyByZWFkb25seSBvYXV0aFRva2VuRW5kcG9pbnQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoQXV0aG9yaXphdGlvbkVuZHBvaW50OiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBvYXV0aElzc3Vlcjogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgb2F1dGhDcmVkZW50aWFsc1NlY3JldDogc2VjcmV0c21hbmFnZXIuSVNlY3JldDtcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoUHJvdmlkZXJOYW1lOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBvYXV0aFByb3ZpZGVyQXJuOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEF1dGhTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ29nbml0byBVc2VyIFBvb2xcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdGaW5PcHNVc2VyUG9vbCcsIHtcbiAgICAgIHVzZXJQb29sTmFtZTogYCR7dGhpcy5zdGFja05hbWV9LXVzZXJzYCxcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiBmYWxzZSxcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICAgIHVzZXJuYW1lOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGF1dG9WZXJpZnk6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICB9LFxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSwgLy8gQWRkIHN5bWJvbCByZXF1aXJlbWVudCBmb3Igc3Ryb25nZXIgc2VjdXJpdHlcbiAgICAgIH0sXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgdGhpcy51c2VyUG9vbElkID0gdXNlclBvb2wudXNlclBvb2xJZDtcbiAgICB0aGlzLnVzZXJQb29sQXJuID0gdXNlclBvb2wudXNlclBvb2xBcm47XG4gICAgdGhpcy51c2VyUG9vbFByb3ZpZGVyTmFtZSA9IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lO1xuXG4gICAgLy8gQWRkIENvZ25pdG8gRG9tYWluIGZvciBPQXV0aFxuICAgIGNvbnN0IHVzZXJQb29sRG9tYWluID0gdXNlclBvb2wuYWRkRG9tYWluKCdGaW5PcHNEb21haW4nLCB7XG4gICAgICBjb2duaXRvRG9tYWluOiB7XG4gICAgICAgIGRvbWFpblByZWZpeDogYGZpbm9wcy1tY3AtJHt0aGlzLmFjY291bnR9LSR7Y2RrLk5hbWVzLnVuaXF1ZUlkKHRoaXMpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTldL2csICcnKS5zdWJzdHJpbmcoMCwgOCl9YCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBPQXV0aCBlbmRwb2ludHMgZm9yIEdhdGV3YXkgYW5kIEFnZW50Q29yZSBJZGVudGl0eVxuICAgIGNvbnN0IGRvbWFpblVybCA9IGBodHRwczovLyR7dXNlclBvb2xEb21haW4uZG9tYWluTmFtZX0uYXV0aC4ke3RoaXMucmVnaW9ufS5hbWF6b25jb2duaXRvLmNvbWA7XG4gICAgdGhpcy5vYXV0aFRva2VuRW5kcG9pbnQgPSBgJHtkb21haW5Vcmx9L29hdXRoMi90b2tlbmA7XG4gICAgdGhpcy5vYXV0aEF1dGhvcml6YXRpb25FbmRwb2ludCA9IGAke2RvbWFpblVybH0vb2F1dGgyL2F1dGhvcml6ZWA7XG4gICAgdGhpcy5vYXV0aElzc3VlciA9IGBodHRwczovL2NvZ25pdG8taWRwLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vJHt1c2VyUG9vbC51c2VyUG9vbElkfWA7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gVXNlciBQb29sIENsaWVudHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgUmVzb3VyY2UgU2VydmVyIGZvciBNMk0gYXV0aGVudGljYXRpb24gKHJlcXVpcmVkIGZvciBjbGllbnRfY3JlZGVudGlhbHMgZmxvdylcbiAgICBjb25zdCBtY3BJbnZva2VTY29wZTogY29nbml0by5SZXNvdXJjZVNlcnZlclNjb3BlID0ge1xuICAgICAgc2NvcGVOYW1lOiAnaW52b2tlJyxcbiAgICAgIHNjb3BlRGVzY3JpcHRpb246ICdJbnZva2UgTUNQIHJ1bnRpbWUgdG9vbHMnLFxuICAgIH07XG5cbiAgICBjb25zdCByZXNvdXJjZVNlcnZlciA9IHVzZXJQb29sLmFkZFJlc291cmNlU2VydmVyKCdGaW5PcHNSZXNvdXJjZVNlcnZlcicsIHtcbiAgICAgIGlkZW50aWZpZXI6ICdtY3AtcnVudGltZS1zZXJ2ZXInLFxuICAgICAgdXNlclBvb2xSZXNvdXJjZVNlcnZlck5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1yZXNvdXJjZS1zZXJ2ZXJgLFxuICAgICAgc2NvcGVzOiBbbWNwSW52b2tlU2NvcGVdLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xpZW50IGZvciBmcm9udGVuZCB1c2VycyAobm8gc2VjcmV0KVxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gdXNlclBvb2wuYWRkQ2xpZW50KCdGaW5PcHNVc2VyUG9vbENsaWVudCcsIHtcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LWNsaWVudGAsXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsXG4gICAgICBhdXRoRmxvd3M6IHtcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxuICAgICAgICB1c2VyU3JwOiB0cnVlLFxuICAgICAgICBjdXN0b206IHRydWUsXG4gICAgICB9LFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBhdXRob3JpemF0aW9uQ29kZUdyYW50OiB0cnVlLFxuICAgICAgICAgIGltcGxpY2l0Q29kZUdyYW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUwsXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLk9QRU5JRCxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuUFJPRklMRSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50SWQgPSB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkO1xuXG4gICAgLy8gTTJNIENsaWVudCBmb3IgR2F0ZXdheSDihpIgTUNQIFNlcnZlciBSdW50aW1lcyAod2l0aCBzZWNyZXQgZm9yIGNsaWVudCBjcmVkZW50aWFscyBmbG93KVxuICAgIGNvbnN0IG0ybUNsaWVudCA9IHVzZXJQb29sLmFkZENsaWVudCgnRmluT3BzTTJNQ2xpZW50Jywge1xuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tbTJtLWNsaWVudGAsXG4gICAgICBnZW5lcmF0ZVNlY3JldDogdHJ1ZSxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyUGFzc3dvcmQ6IGZhbHNlLFxuICAgICAgICB1c2VyU3JwOiBmYWxzZSxcbiAgICAgICAgY3VzdG9tOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBvQXV0aDoge1xuICAgICAgICBmbG93czoge1xuICAgICAgICAgIGNsaWVudENyZWRlbnRpYWxzOiB0cnVlLCAvLyBNMk0gZmxvd1xuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUucmVzb3VyY2VTZXJ2ZXIocmVzb3VyY2VTZXJ2ZXIsIG1jcEludm9rZVNjb3BlKSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLm9hdXRoQ2xpZW50SWQgPSBtMm1DbGllbnQudXNlclBvb2xDbGllbnRJZDtcbiAgICB0aGlzLm9hdXRoQ2xpZW50U2VjcmV0ID0gbTJtQ2xpZW50LnVzZXJQb29sQ2xpZW50U2VjcmV0O1xuXG4gICAgLy8gU3RvcmUgTTJNIE9BdXRoIGNyZWRlbnRpYWxzIGluIFNlY3JldHMgTWFuYWdlciBmb3IgR2F0ZXdheVxuICAgIHRoaXMub2F1dGhDcmVkZW50aWFsc1NlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ09BdXRoQ3JlZGVudGlhbHNTZWNyZXQnLCB7XG4gICAgICBzZWNyZXROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tb2F1dGgtY3JlZGVudGlhbHNgLFxuICAgICAgZGVzY3JpcHRpb246ICdNMk0gT0F1dGggY2xpZW50IGNyZWRlbnRpYWxzIGZvciBBZ2VudENvcmUgR2F0ZXdheScsXG4gICAgICBzZWNyZXRPYmplY3RWYWx1ZToge1xuICAgICAgICBjbGllbnRJZDogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChtMm1DbGllbnQudXNlclBvb2xDbGllbnRJZCksXG4gICAgICAgIGNsaWVudFNlY3JldDogbTJtQ2xpZW50LnVzZXJQb29sQ2xpZW50U2VjcmV0LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBJZGVudGl0eSBQb29sXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgaWRlbnRpdHlQb29sID0gbmV3IGNvZ25pdG8uQ2ZuSWRlbnRpdHlQb29sKHRoaXMsICdGaW5PcHNJZGVudGl0eVBvb2wnLCB7XG4gICAgICBpZGVudGl0eVBvb2xOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOV0vZywgJ18nKX1faWRlbnRpdHlfcG9vbGAsXG4gICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IGZhbHNlLFxuICAgICAgY29nbml0b0lkZW50aXR5UHJvdmlkZXJzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjbGllbnRJZDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgICBwcm92aWRlck5hbWU6IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2xpZW50SWQ6IG0ybUNsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICAgIHByb3ZpZGVyTmFtZTogdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgdGhpcy5pZGVudGl0eVBvb2xJZCA9IGlkZW50aXR5UG9vbC5yZWY7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gSUFNIFJvbGVzIGZvciBJZGVudGl0eSBQb29sXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQXV0aGVudGljYXRlZCBSb2xlIC0gQ2FuIGludm9rZSBNYWluIEFnZW50IFJ1bnRpbWVcbiAgICBjb25zdCBhdXRoZW50aWNhdGVkUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQXV0aGVudGljYXRlZFJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogYCR7dGhpcy5zdGFja05hbWV9LWF1dGhlbnRpY2F0ZWQtcm9sZWAsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uRmVkZXJhdGVkUHJpbmNpcGFsKFxuICAgICAgICAnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tJyxcbiAgICAgICAge1xuICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphdWQnOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgJ0ZvckFueVZhbHVlOlN0cmluZ0xpa2UnOiB7XG4gICAgICAgICAgICAnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tOmFtcic6ICdhdXRoZW50aWNhdGVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICAnc3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHknXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgLy8gTm90ZTogUnVudGltZSBBUk4gd2lsbCBiZSBhZGRlZCBhZnRlciBBZ2VudFN0YWNrIGlzIGRlcGxveWVkXG4gICAgLy8gRnJvbnRlbmQgdXNlcnMgd2lsbCBpbnZva2UgdGhlIG1haW4gYWdlbnQgcnVudGltZSB2aWEgSUFNXG4gICAgYXV0aGVudGljYXRlZFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6SW52b2tlQWdlbnRSdW50aW1lJyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldFJ1bnRpbWUnLFxuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6TGlzdFJ1bnRpbWVzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJ1bnRpbWUvZmlub3BzX2JpbGxpbmdfbWNwKmAsXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpydW50aW1lL2Zpbm9wc19wcmljaW5nX21jcCpgLFxuICAgICAgICBgYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cnVudGltZS9maW5vcHNfcnVudGltZSpgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBVbmF1dGhlbnRpY2F0ZWQgUm9sZSAtIERlbnkgYWxsXG4gICAgY29uc3QgdW5hdXRoZW50aWNhdGVkUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVW5hdXRoZW50aWNhdGVkUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tdW5hdXRoZW50aWNhdGVkLXJvbGVgLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcbiAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogaWRlbnRpdHlQb29sLnJlZixcbiAgICAgICAgICB9LFxuICAgICAgICAgICdGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlJzoge1xuICAgICAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXInOiAndW5hdXRoZW50aWNhdGVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICAnc3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHknXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgdW5hdXRoZW50aWNhdGVkUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuREVOWSxcbiAgICAgIGFjdGlvbnM6IFsnKiddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBBdHRhY2ggcm9sZXMgdG8gSWRlbnRpdHkgUG9vbFxuICAgIG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMsICdJZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudCcsIHtcbiAgICAgIGlkZW50aXR5UG9vbElkOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgcm9sZXM6IHtcbiAgICAgICAgYXV0aGVudGljYXRlZDogYXV0aGVudGljYXRlZFJvbGUucm9sZUFybixcbiAgICAgICAgdW5hdXRoZW50aWNhdGVkOiB1bmF1dGhlbnRpY2F0ZWRSb2xlLnJvbGVBcm4sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFkbWluIFVzZXJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY29nbml0by5DZm5Vc2VyUG9vbFVzZXIodGhpcywgJ0FkbWluVXNlcicsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICB1c2VybmFtZTogJ2FkbWluJyxcbiAgICAgIHVzZXJBdHRyaWJ1dGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnZW1haWwnLFxuICAgICAgICAgIHZhbHVlOiBwcm9wcy5hZG1pbkVtYWlsLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2VtYWlsX3ZlcmlmaWVkJyxcbiAgICAgICAgICB2YWx1ZTogJ3RydWUnLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGRlc2lyZWREZWxpdmVyeU1lZGl1bXM6IFsnRU1BSUwnXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbElkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tVXNlclBvb2xJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIENsaWVudCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tVXNlclBvb2xDbGllbnRJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSWRlbnRpdHlQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5pZGVudGl0eVBvb2xJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBJZGVudGl0eSBQb29sIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1JZGVudGl0eVBvb2xJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1Vc2VyUG9vbEFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhDbGllbnRJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9hdXRoQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ09BdXRoIENsaWVudCBJRCBmb3IgR2F0ZXdheScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhDbGllbnRJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhUb2tlbkVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMub2F1dGhUb2tlbkVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBUb2tlbiBFbmRwb2ludCBmb3IgR2F0ZXdheScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhUb2tlbkVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPQXV0aEF1dGhvcml6YXRpb25FbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9hdXRoQXV0aG9yaXphdGlvbkVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBBdXRob3JpemF0aW9uIEVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1PQXV0aEF1dGhvcml6YXRpb25FbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhJc3N1ZXInLCB7XG4gICAgICB2YWx1ZTogdGhpcy5vYXV0aElzc3VlcixcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0F1dGggSXNzdWVyIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhJc3N1ZXJgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09BdXRoRGlzY292ZXJ5VXJsJywge1xuICAgICAgdmFsdWU6IGAke3RoaXMub2F1dGhJc3N1ZXJ9Ly53ZWxsLWtub3duL29wZW5pZC1jb25maWd1cmF0aW9uYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0F1dGggRGlzY292ZXJ5IFVSTCBmb3IgTTJNIGF1dGhlbnRpY2F0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1PQXV0aERpc2NvdmVyeVVybGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXV0aGVudGljYXRlZFJvbGVBcm4nLCB7XG4gICAgICB2YWx1ZTogYXV0aGVudGljYXRlZFJvbGUucm9sZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXV0aGVudGljYXRlZCBSb2xlIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWRtaW5FbWFpbCcsIHtcbiAgICAgIHZhbHVlOiBwcm9wcy5hZG1pbkVtYWlsLFxuICAgICAgZGVzY3JpcHRpb246ICdBZG1pbiB1c2VyIGVtYWlsICh0ZW1wb3JhcnkgcGFzc3dvcmQgc2VudCB2aWEgZW1haWwpJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZG1pblVzZXJuYW1lJywge1xuICAgICAgdmFsdWU6ICdhZG1pbicsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FkbWluIHVzZXJuYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPQXV0aENyZWRlbnRpYWxzU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMub2F1dGhDcmVkZW50aWFsc1NlY3JldC5zZWNyZXRBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ09BdXRoIENyZWRlbnRpYWxzIFNlY3JldCBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LU9BdXRoQ3JlZGVudGlhbHNTZWNyZXRBcm5gLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE9BdXRoIFByb3ZpZGVyIC0gQ3JlYXRlZCBieSBleHRlcm5hbCBQeXRob24gc2NyaXB0IGFmdGVyIHN0YWNrIGRlcGxveVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIHRoaXMub2F1dGhQcm92aWRlck5hbWUgPSAnZmlub3BzLW1jcC1vYXV0aC1wcm92aWRlcic7XG4gICAgdGhpcy5vYXV0aFByb3ZpZGVyQXJuID0gJ0NSRUFURURfQllfU0NSSVBUJzsgLy8gV2lsbCBiZSByZWFkIGZyb20gb2F1dGgtcHJvdmlkZXItYXJuLnR4dFxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09BdXRoUHJvdmlkZXJOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMub2F1dGhQcm92aWRlck5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ09BdXRoIFByb3ZpZGVyIE5hbWUgKGNyZWF0ZWQgYnkgc2NyaXB0cy9jcmVhdGUtb2F1dGgtcHJvdmlkZXIucHkpJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDREstTmFnIFN1cHByZXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENvZ25pdG8gVXNlciBQb29sIHN1cHByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh1c2VyUG9vbCwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DT0cyJyxcbiAgICAgICAgcmVhc29uOiAnTUZBIG5vdCBlbmZvcmNlZCBmb3IgZGVtby9kZXZlbG9wbWVudCBlbnZpcm9ubWVudC4gUHJvZHVjdGlvbiBkZXBsb3ltZW50cyBzaG91bGQgZW5hYmxlIE1GQSBmb3IgZW5oYW5jZWQgc2VjdXJpdHkuJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzMnLFxuICAgICAgICByZWFzb246ICdBZHZhbmNlZCBzZWN1cml0eSBmZWF0dXJlcyAoY29tcHJvbWlzZWQgY3JlZGVudGlhbHMgY2hlY2spIG5vdCByZXF1aXJlZCBmb3IgZGVtby9kZXZlbG9wbWVudCBlbnZpcm9ubWVudC4gUHJvZHVjdGlvbiBkZXBsb3ltZW50cyBzaG91bGQgZW5hYmxlIEFkdmFuY2VkU2VjdXJpdHlNb2RlLicsXG4gICAgICB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgLy8gQXV0aGVudGljYXRlZCBSb2xlIHN1cHByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhhdXRoZW50aWNhdGVkUm9sZSwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgcmVxdWlyZWQgZm9yIEFnZW50Q29yZSBydW50aW1lIGludm9jYXRpb24gdG8gc3VwcG9ydCBhbGwgc2Vzc2lvbiBJRHMgYW5kIGNvbnZlcnNhdGlvbiB0dXJucyAocnVudGltZSBBUk4gd2l0aCAvKiBzdWZmaXgpJyxcbiAgICAgIH0sXG4gICAgXSwgdHJ1ZSk7XG5cblxuXG4gICAgLy8gT0F1dGggQ3JlZGVudGlhbHMgU2VjcmV0IHN1cHByZXNzaW9uXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHRoaXMub2F1dGhDcmVkZW50aWFsc1NlY3JldCwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TTUc0JyxcbiAgICAgICAgcmVhc29uOiAnT0F1dGggY2xpZW50IGNyZWRlbnRpYWxzIGRvIG5vdCByZXF1aXJlIGF1dG9tYXRpYyByb3RhdGlvbiAtIHRoZXkgYXJlIG1hbmFnZWQgYnkgQ29nbml0byBhbmQgY2FuIGJlIG1hbnVhbGx5IHJvdGF0ZWQgaWYgbmVlZGVkJyxcbiAgICAgIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICAvLyBTdGFjay1sZXZlbCBzdXBwcmVzc2lvbnMgZm9yIENESy1jcmVhdGVkIExhbWJkYSBmdW5jdGlvbnMgKENvZ25pdG8gZG9tYWluIGN1c3RvbSByZXNvdXJjZSlcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkU3RhY2tTdXBwcmVzc2lvbnModGhpcywgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgcmVhc29uOiAnQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlIG1hbmFnZWQgcG9saWN5IGlzIEFXUyBiZXN0IHByYWN0aWNlIGZvciBMYW1iZGEgZnVuY3Rpb25zIGNyZWF0ZWQgYnkgQ0RLIGZvciBDb2duaXRvIGRvbWFpbiBjdXN0b20gcmVzb3VyY2UnLFxuICAgICAgICBhcHBsaWVzVG86IFsnUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSddLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtTDEnLFxuICAgICAgICByZWFzb246ICdMYW1iZGEgZnVuY3Rpb24gaXMgY3JlYXRlZCBhbmQgbWFuYWdlZCBieSBDREsgZm9yIENvZ25pdG8gZG9tYWluIGN1c3RvbSByZXNvdXJjZSAtIHJ1bnRpbWUgaXMgYXV0b21hdGljYWxseSB1cGRhdGVkIGJ5IENESycsXG4gICAgICB9LFxuICAgIF0pO1xuICB9XG59XG4iXX0=