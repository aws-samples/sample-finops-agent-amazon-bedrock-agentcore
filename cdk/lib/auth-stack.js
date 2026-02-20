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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGgtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLGlFQUFtRDtBQUNuRCx5REFBMkM7QUFHM0MscUNBQTBDO0FBTTFDLE1BQWEsU0FBVSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBYXRDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBcUI7UUFDN0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsMkNBQTJDO1FBQzNDLG9CQUFvQjtRQUNwQiwyQ0FBMkM7UUFFM0MsTUFBTSxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUM1RCxZQUFZLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxRQUFRO1lBQ3ZDLGlCQUFpQixFQUFFLEtBQUs7WUFDeEIsYUFBYSxFQUFFO2dCQUNiLEtBQUssRUFBRSxJQUFJO2dCQUNYLFFBQVEsRUFBRSxJQUFJO2FBQ2Y7WUFDRCxVQUFVLEVBQUU7Z0JBQ1YsS0FBSyxFQUFFLElBQUk7YUFDWjtZQUNELGNBQWMsRUFBRTtnQkFDZCxZQUFZLEVBQUUscUNBQXFDO2dCQUNuRCxTQUFTLEVBQUU7b0JBQ1Qsa0NBQWtDO29CQUNsQywwR0FBMEc7b0JBQzFHLE9BQU87b0JBQ1Asa0NBQWtDO29CQUNsQyw4SEFBOEg7b0JBQzlILE9BQU87b0JBQ1AsNENBQTRDO29CQUM1QywwSEFBMEg7aUJBQzNILENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQzthQUNiO1lBQ0QsY0FBYyxFQUFFO2dCQUNkLFNBQVMsRUFBRSxDQUFDO2dCQUNaLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGFBQWEsRUFBRSxJQUFJO2dCQUNuQixj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QUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMzQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGlCQUFpQjtZQUM3QixXQUFXLEVBQUUsbUVBQW1FO1NBQ2pGLENBQUMsQ0FBQztRQUVILDJDQUEyQztRQUMzQyx1QkFBdUI7UUFDdkIsMkNBQTJDO1FBRTNDLGlDQUFpQztRQUNqQyx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLFFBQVEsRUFBRTtZQUNoRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsb0hBQW9IO2FBQzdIO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLHNLQUFzSzthQUMvSztTQUNGLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFVCxrQ0FBa0M7UUFDbEMseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxpQkFBaUIsRUFBRTtZQUN6RDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsbUlBQW1JO2FBQzVJO1NBQ0YsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUlULDZGQUE2RjtRQUM3Rix5QkFBZSxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRTtZQUN6QztnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsd0lBQXdJO2dCQUNoSixTQUFTLEVBQUUsQ0FBQyx1RkFBdUYsQ0FBQzthQUNyRztZQUNEO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw0SEFBNEg7YUFDckk7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE5V0QsOEJBOFdDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcblxuZXhwb3J0IGludGVyZmFjZSBBdXRoU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgYWRtaW5FbWFpbDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQXV0aFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sSWQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sQ2xpZW50SWQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IGlkZW50aXR5UG9vbElkOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbEFybjogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlclBvb2xQcm92aWRlck5hbWU6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoQ2xpZW50SWQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoVG9rZW5FbmRwb2ludDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgb2F1dGhBdXRob3JpemF0aW9uRW5kcG9pbnQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG9hdXRoSXNzdWVyOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBvYXV0aFByb3ZpZGVyTmFtZTogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgb2F1dGhQcm92aWRlckFybjogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBBdXRoU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENvZ25pdG8gVXNlciBQb29sXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnRmluT3BzVXNlclBvb2wnLCB7XG4gICAgICB1c2VyUG9vbE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS11c2Vyc2AsXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogZmFsc2UsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7XG4gICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICB1c2VybmFtZTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBhdXRvVmVyaWZ5OiB7XG4gICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHVzZXJJbnZpdGF0aW9uOiB7XG4gICAgICAgIGVtYWlsU3ViamVjdDogJ1lvdXIgRmluT3BzIEFnZW50IExvZ2luIENyZWRlbnRpYWxzJyxcbiAgICAgICAgZW1haWxCb2R5OiBbXG4gICAgICAgICAgJzxoMj5XZWxjb21lIHRvIEZpbk9wcyBBZ2VudDwvaDI+JyxcbiAgICAgICAgICAnPHA+WW91ciBhZG1pbiBhY2NvdW50IGhhcyBiZWVuIGNyZWF0ZWQuIFlvdSB3aWxsIGJlIHByb21wdGVkIHRvIGNoYW5nZSB5b3VyIHBhc3N3b3JkIG9uIGZpcnN0IGxvZ2luLjwvcD4nLFxuICAgICAgICAgICc8YnIvPicsXG4gICAgICAgICAgJzxwPjxzdHJvbmc+VXNlcm5hbWU8L3N0cm9uZz48L3A+JyxcbiAgICAgICAgICAnPHAgc3R5bGU9XCJmb250LWZhbWlseTogbW9ub3NwYWNlOyBmb250LXNpemU6IDE2cHg7IGJhY2tncm91bmQ6ICNmMGYwZjA7IHBhZGRpbmc6IDhweDsgZGlzcGxheTogaW5saW5lLWJsb2NrO1wiPnt1c2VybmFtZX08L3A+JyxcbiAgICAgICAgICAnPGJyLz4nLFxuICAgICAgICAgICc8cD48c3Ryb25nPlRlbXBvcmFyeSBQYXNzd29yZDwvc3Ryb25nPjwvcD4nLFxuICAgICAgICAgICc8cCBzdHlsZT1cImZvbnQtZmFtaWx5OiBtb25vc3BhY2U7IGZvbnQtc2l6ZTogMTZweDsgYmFja2dyb3VuZDogI2YwZjBmMDsgcGFkZGluZzogOHB4OyBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XCI+eyMjIyN9PC9wPicsXG4gICAgICAgIF0uam9pbignXFxuJyksXG4gICAgICB9LFxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSwgLy8gQWRkIHN5bWJvbCByZXF1aXJlbWVudCBmb3Igc3Ryb25nZXIgc2VjdXJpdHlcbiAgICAgIH0sXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgdGhpcy51c2VyUG9vbElkID0gdXNlclBvb2wudXNlclBvb2xJZDtcbiAgICB0aGlzLnVzZXJQb29sQXJuID0gdXNlclBvb2wudXNlclBvb2xBcm47XG4gICAgdGhpcy51c2VyUG9vbFByb3ZpZGVyTmFtZSA9IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lO1xuXG4gICAgLy8gQWRkIENvZ25pdG8gRG9tYWluIGZvciBPQXV0aFxuICAgIGNvbnN0IHVzZXJQb29sRG9tYWluID0gdXNlclBvb2wuYWRkRG9tYWluKCdGaW5PcHNEb21haW4nLCB7XG4gICAgICBjb2duaXRvRG9tYWluOiB7XG4gICAgICAgIGRvbWFpblByZWZpeDogYGZpbm9wcy1tY3AtJHt0aGlzLmFjY291bnR9LSR7Y2RrLk5hbWVzLnVuaXF1ZUlkKHRoaXMpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTldL2csICcnKS5zdWJzdHJpbmcoMCwgOCl9YCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBPQXV0aCBlbmRwb2ludHMgZm9yIEdhdGV3YXkgYW5kIEFnZW50Q29yZSBJZGVudGl0eVxuICAgIGNvbnN0IGRvbWFpblVybCA9IGBodHRwczovLyR7dXNlclBvb2xEb21haW4uZG9tYWluTmFtZX0uYXV0aC4ke3RoaXMucmVnaW9ufS5hbWF6b25jb2duaXRvLmNvbWA7XG4gICAgdGhpcy5vYXV0aFRva2VuRW5kcG9pbnQgPSBgJHtkb21haW5Vcmx9L29hdXRoMi90b2tlbmA7XG4gICAgdGhpcy5vYXV0aEF1dGhvcml6YXRpb25FbmRwb2ludCA9IGAke2RvbWFpblVybH0vb2F1dGgyL2F1dGhvcml6ZWA7XG4gICAgdGhpcy5vYXV0aElzc3VlciA9IGBodHRwczovL2NvZ25pdG8taWRwLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vJHt1c2VyUG9vbC51c2VyUG9vbElkfWA7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gVXNlciBQb29sIENsaWVudHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgUmVzb3VyY2UgU2VydmVyIGZvciBNMk0gYXV0aGVudGljYXRpb24gKHJlcXVpcmVkIGZvciBjbGllbnRfY3JlZGVudGlhbHMgZmxvdylcbiAgICBjb25zdCBtY3BJbnZva2VTY29wZTogY29nbml0by5SZXNvdXJjZVNlcnZlclNjb3BlID0ge1xuICAgICAgc2NvcGVOYW1lOiAnaW52b2tlJyxcbiAgICAgIHNjb3BlRGVzY3JpcHRpb246ICdJbnZva2UgTUNQIHJ1bnRpbWUgdG9vbHMnLFxuICAgIH07XG5cbiAgICBjb25zdCByZXNvdXJjZVNlcnZlciA9IHVzZXJQb29sLmFkZFJlc291cmNlU2VydmVyKCdGaW5PcHNSZXNvdXJjZVNlcnZlcicsIHtcbiAgICAgIGlkZW50aWZpZXI6ICdtY3AtcnVudGltZS1zZXJ2ZXInLFxuICAgICAgdXNlclBvb2xSZXNvdXJjZVNlcnZlck5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1yZXNvdXJjZS1zZXJ2ZXJgLFxuICAgICAgc2NvcGVzOiBbbWNwSW52b2tlU2NvcGVdLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xpZW50IGZvciBmcm9udGVuZCB1c2VycyAobm8gc2VjcmV0KVxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gdXNlclBvb2wuYWRkQ2xpZW50KCdGaW5PcHNVc2VyUG9vbENsaWVudCcsIHtcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LWNsaWVudGAsXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsXG4gICAgICBhdXRoRmxvd3M6IHtcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxuICAgICAgICB1c2VyU3JwOiB0cnVlLFxuICAgICAgICBjdXN0b206IHRydWUsXG4gICAgICB9LFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBhdXRob3JpemF0aW9uQ29kZUdyYW50OiB0cnVlLFxuICAgICAgICAgIGltcGxpY2l0Q29kZUdyYW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUwsXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLk9QRU5JRCxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuUFJPRklMRSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50SWQgPSB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkO1xuXG4gICAgLy8gTTJNIENsaWVudCBmb3IgR2F0ZXdheSDihpIgTUNQIFNlcnZlciBSdW50aW1lcyAod2l0aCBzZWNyZXQgZm9yIGNsaWVudCBjcmVkZW50aWFscyBmbG93KVxuICAgIGNvbnN0IG0ybUNsaWVudCA9IHVzZXJQb29sLmFkZENsaWVudCgnRmluT3BzTTJNQ2xpZW50Jywge1xuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tbTJtLWNsaWVudGAsXG4gICAgICBnZW5lcmF0ZVNlY3JldDogdHJ1ZSxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyUGFzc3dvcmQ6IGZhbHNlLFxuICAgICAgICB1c2VyU3JwOiBmYWxzZSxcbiAgICAgICAgY3VzdG9tOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBvQXV0aDoge1xuICAgICAgICBmbG93czoge1xuICAgICAgICAgIGNsaWVudENyZWRlbnRpYWxzOiB0cnVlLCAvLyBNMk0gZmxvd1xuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUucmVzb3VyY2VTZXJ2ZXIocmVzb3VyY2VTZXJ2ZXIsIG1jcEludm9rZVNjb3BlKSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLm9hdXRoQ2xpZW50SWQgPSBtMm1DbGllbnQudXNlclBvb2xDbGllbnRJZDtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBJZGVudGl0eSBQb29sXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgaWRlbnRpdHlQb29sID0gbmV3IGNvZ25pdG8uQ2ZuSWRlbnRpdHlQb29sKHRoaXMsICdGaW5PcHNJZGVudGl0eVBvb2wnLCB7XG4gICAgICBpZGVudGl0eVBvb2xOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOV0vZywgJ18nKX1faWRlbnRpdHlfcG9vbGAsXG4gICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IGZhbHNlLFxuICAgICAgY29nbml0b0lkZW50aXR5UHJvdmlkZXJzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjbGllbnRJZDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgICBwcm92aWRlck5hbWU6IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2xpZW50SWQ6IG0ybUNsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICAgIHByb3ZpZGVyTmFtZTogdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgdGhpcy5pZGVudGl0eVBvb2xJZCA9IGlkZW50aXR5UG9vbC5yZWY7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gSUFNIFJvbGVzIGZvciBJZGVudGl0eSBQb29sXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQXV0aGVudGljYXRlZCBSb2xlIC0gQ2FuIGludm9rZSBNYWluIEFnZW50IFJ1bnRpbWVcbiAgICBjb25zdCBhdXRoZW50aWNhdGVkUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQXV0aGVudGljYXRlZFJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogYCR7dGhpcy5zdGFja05hbWV9LWF1dGhlbnRpY2F0ZWQtcm9sZWAsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uRmVkZXJhdGVkUHJpbmNpcGFsKFxuICAgICAgICAnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tJyxcbiAgICAgICAge1xuICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphdWQnOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgJ0ZvckFueVZhbHVlOlN0cmluZ0xpa2UnOiB7XG4gICAgICAgICAgICAnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tOmFtcic6ICdhdXRoZW50aWNhdGVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICAnc3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHknXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgLy8gTm90ZTogUnVudGltZSBBUk4gd2lsbCBiZSBhZGRlZCBhZnRlciBBZ2VudFN0YWNrIGlzIGRlcGxveWVkXG4gICAgLy8gRnJvbnRlbmQgdXNlcnMgd2lsbCBpbnZva2UgdGhlIG1haW4gYWdlbnQgcnVudGltZSB2aWEgSUFNXG4gICAgYXV0aGVudGljYXRlZFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6SW52b2tlQWdlbnRSdW50aW1lJyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldFJ1bnRpbWUnLFxuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6TGlzdFJ1bnRpbWVzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJ1bnRpbWUvZmlub3BzX2JpbGxpbmdfbWNwKmAsXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpydW50aW1lL2Zpbm9wc19wcmljaW5nX21jcCpgLFxuICAgICAgICBgYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cnVudGltZS9maW5vcHNfcnVudGltZSpgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBVbmF1dGhlbnRpY2F0ZWQgUm9sZSAtIERlbnkgYWxsXG4gICAgY29uc3QgdW5hdXRoZW50aWNhdGVkUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVW5hdXRoZW50aWNhdGVkUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tdW5hdXRoZW50aWNhdGVkLXJvbGVgLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcbiAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogaWRlbnRpdHlQb29sLnJlZixcbiAgICAgICAgICB9LFxuICAgICAgICAgICdGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlJzoge1xuICAgICAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXInOiAndW5hdXRoZW50aWNhdGVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICAnc3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHknXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgdW5hdXRoZW50aWNhdGVkUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuREVOWSxcbiAgICAgIGFjdGlvbnM6IFsnKiddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBBdHRhY2ggcm9sZXMgdG8gSWRlbnRpdHkgUG9vbFxuICAgIG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMsICdJZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudCcsIHtcbiAgICAgIGlkZW50aXR5UG9vbElkOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgcm9sZXM6IHtcbiAgICAgICAgYXV0aGVudGljYXRlZDogYXV0aGVudGljYXRlZFJvbGUucm9sZUFybixcbiAgICAgICAgdW5hdXRoZW50aWNhdGVkOiB1bmF1dGhlbnRpY2F0ZWRSb2xlLnJvbGVBcm4sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFkbWluIFVzZXJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY29nbml0by5DZm5Vc2VyUG9vbFVzZXIodGhpcywgJ0FkbWluVXNlcicsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICB1c2VybmFtZTogJ2FkbWluJyxcbiAgICAgIHVzZXJBdHRyaWJ1dGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnZW1haWwnLFxuICAgICAgICAgIHZhbHVlOiBwcm9wcy5hZG1pbkVtYWlsLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2VtYWlsX3ZlcmlmaWVkJyxcbiAgICAgICAgICB2YWx1ZTogJ3RydWUnLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGRlc2lyZWREZWxpdmVyeU1lZGl1bXM6IFsnRU1BSUwnXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbElkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tVXNlclBvb2xJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIENsaWVudCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tVXNlclBvb2xDbGllbnRJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSWRlbnRpdHlQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5pZGVudGl0eVBvb2xJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBJZGVudGl0eSBQb29sIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1JZGVudGl0eVBvb2xJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1Vc2VyUG9vbEFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhDbGllbnRJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9hdXRoQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ09BdXRoIENsaWVudCBJRCBmb3IgR2F0ZXdheScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhDbGllbnRJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhUb2tlbkVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMub2F1dGhUb2tlbkVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBUb2tlbiBFbmRwb2ludCBmb3IgR2F0ZXdheScsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhUb2tlbkVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPQXV0aEF1dGhvcml6YXRpb25FbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9hdXRoQXV0aG9yaXphdGlvbkVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBBdXRob3JpemF0aW9uIEVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1PQXV0aEF1dGhvcml6YXRpb25FbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhJc3N1ZXInLCB7XG4gICAgICB2YWx1ZTogdGhpcy5vYXV0aElzc3VlcixcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0F1dGggSXNzdWVyIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tT0F1dGhJc3N1ZXJgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09BdXRoRGlzY292ZXJ5VXJsJywge1xuICAgICAgdmFsdWU6IGAke3RoaXMub2F1dGhJc3N1ZXJ9Ly53ZWxsLWtub3duL29wZW5pZC1jb25maWd1cmF0aW9uYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0F1dGggRGlzY292ZXJ5IFVSTCBmb3IgTTJNIGF1dGhlbnRpY2F0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1PQXV0aERpc2NvdmVyeVVybGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXV0aGVudGljYXRlZFJvbGVBcm4nLCB7XG4gICAgICB2YWx1ZTogYXV0aGVudGljYXRlZFJvbGUucm9sZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXV0aGVudGljYXRlZCBSb2xlIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWRtaW5FbWFpbCcsIHtcbiAgICAgIHZhbHVlOiBwcm9wcy5hZG1pbkVtYWlsLFxuICAgICAgZGVzY3JpcHRpb246ICdBZG1pbiB1c2VyIGVtYWlsICh0ZW1wb3JhcnkgcGFzc3dvcmQgc2VudCB2aWEgZW1haWwpJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZG1pblVzZXJuYW1lJywge1xuICAgICAgdmFsdWU6ICdhZG1pbicsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FkbWluIHVzZXJuYW1lJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPQXV0aCBQcm92aWRlciAtIENyZWF0ZWQgYnkgZXh0ZXJuYWwgUHl0aG9uIHNjcmlwdCBhZnRlciBzdGFjayBkZXBsb3lcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICB0aGlzLm9hdXRoUHJvdmlkZXJOYW1lID0gJ2Zpbm9wcy1tY3Atb2F1dGgtcHJvdmlkZXInO1xuICAgIHRoaXMub2F1dGhQcm92aWRlckFybiA9ICdDUkVBVEVEX0JZX1NDUklQVCc7IC8vIFdpbGwgYmUgcmVhZCBmcm9tIG9hdXRoLXByb3ZpZGVyLWFybi50eHRcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPQXV0aFByb3ZpZGVyTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9hdXRoUHJvdmlkZXJOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBQcm92aWRlciBOYW1lIChjcmVhdGVkIGJ5IHNjcmlwdHMvY3JlYXRlLW9hdXRoLXByb3ZpZGVyLnB5KScsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ0RLLU5hZyBTdXBwcmVzc2lvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDb2duaXRvIFVzZXIgUG9vbCBzdXBwcmVzc2lvbnNcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnModXNlclBvb2wsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HMicsXG4gICAgICAgIHJlYXNvbjogJ01GQSBub3QgZW5mb3JjZWQgZm9yIGRlbW8vZGV2ZWxvcG1lbnQgZW52aXJvbm1lbnQuIFByb2R1Y3Rpb24gZGVwbG95bWVudHMgc2hvdWxkIGVuYWJsZSBNRkEgZm9yIGVuaGFuY2VkIHNlY3VyaXR5LicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DT0czJyxcbiAgICAgICAgcmVhc29uOiAnQWR2YW5jZWQgc2VjdXJpdHkgZmVhdHVyZXMgKGNvbXByb21pc2VkIGNyZWRlbnRpYWxzIGNoZWNrKSBub3QgcmVxdWlyZWQgZm9yIGRlbW8vZGV2ZWxvcG1lbnQgZW52aXJvbm1lbnQuIFByb2R1Y3Rpb24gZGVwbG95bWVudHMgc2hvdWxkIGVuYWJsZSBBZHZhbmNlZFNlY3VyaXR5TW9kZS4nLFxuICAgICAgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIC8vIEF1dGhlbnRpY2F0ZWQgUm9sZSBzdXBwcmVzc2lvbnNcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoYXV0aGVudGljYXRlZFJvbGUsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1dpbGRjYXJkIHJlcXVpcmVkIGZvciBBZ2VudENvcmUgcnVudGltZSBpbnZvY2F0aW9uIHRvIHN1cHBvcnQgYWxsIHNlc3Npb24gSURzIGFuZCBjb252ZXJzYXRpb24gdHVybnMgKHJ1bnRpbWUgQVJOIHdpdGggLyogc3VmZml4KScsXG4gICAgICB9LFxuICAgIF0sIHRydWUpO1xuXG5cblxuICAgIC8vIFN0YWNrLWxldmVsIHN1cHByZXNzaW9ucyBmb3IgQ0RLLWNyZWF0ZWQgTGFtYmRhIGZ1bmN0aW9ucyAoQ29nbml0byBkb21haW4gY3VzdG9tIHJlc291cmNlKVxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyh0aGlzLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICByZWFzb246ICdBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgbWFuYWdlZCBwb2xpY3kgaXMgQVdTIGJlc3QgcHJhY3RpY2UgZm9yIExhbWJkYSBmdW5jdGlvbnMgY3JlYXRlZCBieSBDREsgZm9yIENvZ25pdG8gZG9tYWluIGN1c3RvbSByZXNvdXJjZScsXG4gICAgICAgIGFwcGxpZXNUbzogWydQb2xpY3k6OmFybjo8QVdTOjpQYXJ0aXRpb24+OmlhbTo6YXdzOnBvbGljeS9zZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJ10sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1MMScsXG4gICAgICAgIHJlYXNvbjogJ0xhbWJkYSBmdW5jdGlvbiBpcyBjcmVhdGVkIGFuZCBtYW5hZ2VkIGJ5IENESyBmb3IgQ29nbml0byBkb21haW4gY3VzdG9tIHJlc291cmNlIC0gcnVudGltZSBpcyBhdXRvbWF0aWNhbGx5IHVwZGF0ZWQgYnkgQ0RLJyxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==