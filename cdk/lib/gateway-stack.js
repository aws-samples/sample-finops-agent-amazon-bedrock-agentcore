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
exports.AgentCoreGatewayStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const cr = __importStar(require("aws-cdk-lib/custom-resources"));
const cdk_nag_1 = require("cdk-nag");
class AgentCoreGatewayStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========================================
        // Retrieve AuthStack M2M client secret
        // ========================================
        const describeM2MClient = new cr.AwsCustomResource(this, 'DescribeM2MClient', {
            onCreate: {
                service: 'CognitoIdentityServiceProvider',
                action: 'describeUserPoolClient',
                parameters: {
                    UserPoolId: props.authUserPoolId,
                    ClientId: props.authM2mClientId,
                },
                physicalResourceId: cr.PhysicalResourceId.of('m2m-client-secret'),
            },
            policy: cr.AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['cognito-idp:DescribeUserPoolClient'],
                    resources: [props.authUserPoolArn],
                }),
            ]),
        });
        const m2mClientSecret = describeM2MClient.getResponseField('UserPoolClient.ClientSecret');
        // ========================================
        // Gateway Token Exchange Policy (managed policy, wildcard)
        // ========================================
        const tokenExchangePolicy = new iam.ManagedPolicy(this, 'GatewayTokenExchangePolicy', {
            statements: [
                new iam.PolicyStatement({
                    sid: 'AgentCoreIdentityTokenExchange',
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'bedrock-agentcore:GetWorkloadAccessToken',
                        'bedrock-agentcore:GetResourceOauth2Token',
                    ],
                    resources: ['*'],
                }),
            ],
        });
        // ========================================
        // Gateway Service Role
        // ========================================
        const gatewayRole = new iam.Role(this, 'GatewayServiceRole', {
            description: 'Service role for FinOps AgentCore Gateway',
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
            managedPolicies: [tokenExchangePolicy],
        });
        // ========================================
        // OAuth Provider (Lambda custom resource)
        // Uses AuthStack's Cognito for outbound auth to MCP runtimes
        // ========================================
        const oauthProviderFn = new lambda.Function(this, 'OAuthProviderFunction', {
            runtime: lambda.Runtime.PYTHON_3_14,
            handler: 'index.handler',
            timeout: cdk.Duration.minutes(2),
            code: lambda.Code.fromInline(`
import json
import logging
import urllib.request
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def send_cfn_response(event, status, data=None, reason=None, physical_id=None):
    response_body = json.dumps({
        'Status': status,
        'Reason': reason or 'See CloudWatch Logs',
        'PhysicalResourceId': physical_id or event.get('PhysicalResourceId', event['RequestId']),
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': data or {},
    })
    response_url = event['ResponseURL']
    if not response_url.startswith('https://'):
        raise ValueError(f'Invalid response URL scheme')
    req = urllib.request.Request(
        response_url,
        data=response_body.encode('utf-8'),
        headers={'Content-Type': ''},
        method='PUT',
    )
    urllib.request.urlopen(req)

def handler(event, context):
    logger.info(f'Event: {json.dumps(event)}')
    request_type = event['RequestType']
    props = event['ResourceProperties']
    provider_name = props.get('ProviderName', '')
    region = props.get('Region', 'us-east-1')
    client = boto3.client('bedrock-agentcore-control', region_name=region)

    if request_type == 'Delete':
        try:
            client.delete_oauth2_credential_provider(name=provider_name)
            send_cfn_response(event, 'SUCCESS')
        except Exception:
            send_cfn_response(event, 'SUCCESS')
        return

    try:
        response = client.create_oauth2_credential_provider(
            name=provider_name,
            credentialProviderVendor='CustomOauth2',
            oauth2ProviderConfigInput={
                'customOauth2ProviderConfig': {
                    'oauthDiscovery': {
                        'discoveryUrl': props.get('DiscoveryUrl', ''),
                    },
                    'clientId': props.get('ClientId', ''),
                    'clientSecret': props.get('ClientSecret', ''),
                },
            },
        )
        provider_arn = response.get('credentialProviderArn', '')
        secret_arn = response.get('clientSecretArn', {}).get('secretArn', '')
        logger.info(f'Created provider: {provider_arn}')
        send_cfn_response(event, 'SUCCESS', data={
            'ProviderArn': provider_arn,
            'SecretArn': secret_arn,
        }, physical_id=provider_name)
    except Exception as e:
        logger.error(f'Create failed: {e}')
        send_cfn_response(event, 'FAILED', reason=str(e))
`),
        });
        oauthProviderFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:CreateOauth2CredentialProvider',
                'bedrock-agentcore:DeleteOauth2CredentialProvider',
                'bedrock-agentcore:GetOauth2CredentialProvider',
                'bedrock-agentcore:CreateTokenVault',
                'bedrock-agentcore:GetTokenVault',
            ],
            resources: ['*'],
        }));
        oauthProviderFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'secretsmanager:CreateSecret',
                'secretsmanager:DeleteSecret',
                'secretsmanager:PutSecretValue',
                'secretsmanager:TagResource',
            ],
            resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity*`,
            ],
        }));
        const oauthProvider = new cdk.CustomResource(this, 'OAuthProvider', {
            serviceToken: oauthProviderFn.functionArn,
            properties: {
                ProviderName: `${this.stackName}-oauth-provider`,
                DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.authUserPoolId}/.well-known/openid-configuration`,
                ClientId: props.authM2mClientId,
                ClientSecret: m2mClientSecret,
                Region: this.region,
            },
        });
        const oauthProviderArn = oauthProvider.getAttString('ProviderArn');
        const oauthSecretArn = oauthProvider.getAttString('SecretArn');
        // ========================================
        // Default Policy on Gateway Role (scoped to OAuth provider resources)
        // ========================================
        gatewayRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:GetResourceOauth2Token',
                'bedrock-agentcore:GetWorkloadAccessToken',
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
            ],
            resources: [oauthProviderArn, oauthSecretArn],
        }));
        // ========================================
        // Gateway (AWS_IAM auth — Main Runtime calls via InvokeGateway API)
        // ========================================
        const gateway = new cdk.CfnResource(this, 'McpGateway', {
            type: 'AWS::BedrockAgentCore::Gateway',
            properties: {
                Name: 'finops-gateway',
                Description: 'FinOps Gateway for billing and pricing MCP tools (IAM auth)',
                ProtocolType: 'MCP',
                AuthorizerType: 'AWS_IAM',
                ProtocolConfiguration: {
                    Mcp: {
                        Instructions: 'FinOps gateway for billing and pricing MCP tools',
                        SearchType: 'SEMANTIC',
                        SupportedVersions: ['2025-03-26'],
                    },
                },
                RoleArn: gatewayRole.roleArn,
            },
        });
        gateway.node.addDependency(oauthProvider);
        this.gatewayArn = gateway.getAtt('GatewayArn').toString();
        const gatewayId = gateway.getAtt('GatewayIdentifier').toString();
        this.gatewayUrl = gateway.getAtt('GatewayUrl').toString();
        // ========================================
        // Gateway Targets (MCP Server endpoints)
        // ========================================
        const billingTarget = new cdk.CfnResource(this, 'BillingMcpTarget', {
            type: 'AWS::BedrockAgentCore::GatewayTarget',
            properties: {
                GatewayIdentifier: gatewayId,
                Name: 'billingMcp',
                Description: 'AWS Labs Billing MCP Server on AgentCore Runtime',
                TargetConfiguration: {
                    Mcp: { McpServer: { Endpoint: props.billingMcpRuntimeEndpoint } },
                },
                CredentialProviderConfigurations: [{
                        CredentialProviderType: 'OAUTH',
                        CredentialProvider: {
                            OauthCredentialProvider: {
                                ProviderArn: oauthProviderArn,
                                Scopes: ['mcp-runtime-server/invoke'],
                            },
                        },
                    }],
            },
        });
        billingTarget.node.addDependency(gateway);
        const pricingTarget = new cdk.CfnResource(this, 'PricingMcpTarget', {
            type: 'AWS::BedrockAgentCore::GatewayTarget',
            properties: {
                GatewayIdentifier: gatewayId,
                Name: 'pricingMcp',
                Description: 'AWS Labs Pricing MCP Server on AgentCore Runtime',
                TargetConfiguration: {
                    Mcp: { McpServer: { Endpoint: props.pricingMcpRuntimeEndpoint } },
                },
                CredentialProviderConfigurations: [{
                        CredentialProviderType: 'OAUTH',
                        CredentialProvider: {
                            OauthCredentialProvider: {
                                ProviderArn: oauthProviderArn,
                                Scopes: ['mcp-runtime-server/invoke'],
                            },
                        },
                    }],
            },
        });
        pricingTarget.node.addDependency(gateway);
        // ========================================
        // Outputs
        // ========================================
        new cdk.CfnOutput(this, 'GatewayArn', {
            value: this.gatewayArn,
            description: 'AgentCore Gateway ARN',
            exportName: `${this.stackName}-GatewayArn`,
        });
        new cdk.CfnOutput(this, 'GatewayUrl', {
            value: this.gatewayUrl,
            description: 'AgentCore Gateway URL',
            exportName: `${this.stackName}-GatewayUrl`,
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(gatewayRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore Identity token exchange and OAuth provider management.' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(oauthProviderFn, [
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard required for AgentCore Identity token vault creation and bedrock-agentcore-identity secrets namespace.' },
        ], true);
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore Identity token exchange, OAuth credential provider management.', appliesTo: ['Resource::*'] },
            { id: 'AwsSolutions-L1', reason: 'Lambda runtime version managed by CDK.' },
        ]);
    }
}
exports.AgentCoreGatewayStack = AgentCoreGatewayStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2F0ZXdheS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImdhdGV3YXktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHlEQUEyQztBQUMzQywrREFBaUQ7QUFDakQsaUVBQW1EO0FBRW5ELHFDQUEwQztBQWMxQyxNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBSWxELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBaUM7UUFDekUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsMkNBQTJDO1FBQzNDLHVDQUF1QztRQUN2QywyQ0FBMkM7UUFFM0MsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDNUUsUUFBUSxFQUFFO2dCQUNSLE9BQU8sRUFBRSxnQ0FBZ0M7Z0JBQ3pDLE1BQU0sRUFBRSx3QkFBd0I7Z0JBQ2hDLFVBQVUsRUFBRTtvQkFDVixVQUFVLEVBQUUsS0FBSyxDQUFDLGNBQWM7b0JBQ2hDLFFBQVEsRUFBRSxLQUFLLENBQUMsZUFBZTtpQkFDaEM7Z0JBQ0Qsa0JBQWtCLEVBQUUsRUFBRSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQzthQUNsRTtZQUNELE1BQU0sRUFBRSxFQUFFLENBQUMsdUJBQXVCLENBQUMsY0FBYyxDQUFDO2dCQUNoRCxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7b0JBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7b0JBQ3hCLE9BQU8sRUFBRSxDQUFDLG9DQUFvQyxDQUFDO29CQUMvQyxTQUFTLEVBQUUsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDO2lCQUNuQyxDQUFDO2FBQ0gsQ0FBQztTQUNILENBQUMsQ0FBQztR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LENBQUMsdUJBQXVCLENBQUMsZUFBZSxFQUFFO1lBQ3ZELEVBQUUsRUFBRSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSxpSEFBaUgsRUFBRTtTQUN2SixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQseUJBQWUsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUU7WUFDekMsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLG1EQUFtRCxFQUFFLFNBQVMsRUFBRSxDQUFDLHVGQUF1RixDQUFDLEVBQUU7WUFDOUwsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLHVGQUF1RixFQUFFLFNBQVMsRUFBRSxDQUFDLGFBQWEsQ0FBQyxFQUFFO1lBQ3hKLEVBQUUsRUFBRSxFQUFFLGlCQUFpQixFQUFFLE1BQU0sRUFBRSx3Q0FBd0MsRUFBRTtTQUM1RSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFqVEQsc0RBaVRDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcblxuZXhwb3J0IGludGVyZmFjZSBBZ2VudENvcmVHYXRld2F5U3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLy8gTUNQIFJ1bnRpbWUgZW5kcG9pbnRzIGZyb20gTUNQUnVudGltZVN0YWNrXG4gIGJpbGxpbmdNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIGJpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQ6IHN0cmluZztcbiAgcHJpY2luZ01jcFJ1bnRpbWVBcm46IHN0cmluZztcbiAgcHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludDogc3RyaW5nO1xuICAvLyBBdXRoU3RhY2sgQ29nbml0byAtIHVzZWQgZm9yIE9BdXRoIHByb3ZpZGVyIChvdXRib3VuZCBhdXRoIHRvIHJ1bnRpbWVzKVxuICBhdXRoVXNlclBvb2xJZDogc3RyaW5nO1xuICBhdXRoVXNlclBvb2xBcm46IHN0cmluZztcbiAgYXV0aE0ybUNsaWVudElkOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBBZ2VudENvcmVHYXRld2F5U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZ2F0ZXdheUFybjogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgZ2F0ZXdheVVybDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBBZ2VudENvcmVHYXRld2F5U3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFJldHJpZXZlIEF1dGhTdGFjayBNMk0gY2xpZW50IHNlY3JldFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IGRlc2NyaWJlTTJNQ2xpZW50ID0gbmV3IGNyLkF3c0N1c3RvbVJlc291cmNlKHRoaXMsICdEZXNjcmliZU0yTUNsaWVudCcsIHtcbiAgICAgIG9uQ3JlYXRlOiB7XG4gICAgICAgIHNlcnZpY2U6ICdDb2duaXRvSWRlbnRpdHlTZXJ2aWNlUHJvdmlkZXInLFxuICAgICAgICBhY3Rpb246ICdkZXNjcmliZVVzZXJQb29sQ2xpZW50JyxcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIFVzZXJQb29sSWQ6IHByb3BzLmF1dGhVc2VyUG9vbElkLFxuICAgICAgICAgIENsaWVudElkOiBwcm9wcy5hdXRoTTJtQ2xpZW50SWQsXG4gICAgICAgIH0sXG4gICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZDogY3IuUGh5c2ljYWxSZXNvdXJjZUlkLm9mKCdtMm0tY2xpZW50LXNlY3JldCcpLFxuICAgICAgfSxcbiAgICAgIHBvbGljeTogY3IuQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuZnJvbVN0YXRlbWVudHMoW1xuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgIGFjdGlvbnM6IFsnY29nbml0by1pZHA6RGVzY3JpYmVVc2VyUG9vbENsaWVudCddLFxuICAgICAgICAgIHJlc291cmNlczogW3Byb3BzLmF1dGhVc2VyUG9vbEFybl0sXG4gICAgICAgIH0pLFxuICAgICAgXSksXG4gICAgfSk7XG5cbiAgICBjb25zdCBtMm1DbGllbnRTZWNyZXQgPSBkZXNjcmliZU0yTUNsaWVudC5nZXRSZXNwb25zZUZpZWxkKCdVc2VyUG9vbENsaWVudC5DbGllbnRTZWNyZXQnKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBHYXRld2F5IFRva2VuIEV4Y2hhbmdlIFBvbGljeSAobWFuYWdlZCBwb2xpY3ksIHdpbGRjYXJkKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IHRva2VuRXhjaGFuZ2VQb2xpY3kgPSBuZXcgaWFtLk1hbmFnZWRQb2xpY3kodGhpcywgJ0dhdGV3YXlUb2tlbkV4Y2hhbmdlUG9saWN5Jywge1xuICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgc2lkOiAnQWdlbnRDb3JlSWRlbnRpdHlUb2tlbkV4Y2hhbmdlJyxcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldFdvcmtsb2FkQWNjZXNzVG9rZW4nLFxuICAgICAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldFJlc291cmNlT2F1dGgyVG9rZW4nLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgU2VydmljZSBSb2xlXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgZ2F0ZXdheVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0dhdGV3YXlTZXJ2aWNlUm9sZScsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VydmljZSByb2xlIGZvciBGaW5PcHMgQWdlbnRDb3JlIEdhdGV3YXknLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW3Rva2VuRXhjaGFuZ2VQb2xpY3ldLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE9BdXRoIFByb3ZpZGVyIChMYW1iZGEgY3VzdG9tIHJlc291cmNlKVxuICAgIC8vIFVzZXMgQXV0aFN0YWNrJ3MgQ29nbml0byBmb3Igb3V0Ym91bmQgYXV0aCB0byBNQ1AgcnVudGltZXNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBvYXV0aFByb3ZpZGVyRm4gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdPQXV0aFByb3ZpZGVyRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xNCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDIpLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUlubGluZShgXG5pbXBvcnQganNvblxuaW1wb3J0IGxvZ2dpbmdcbmltcG9ydCB1cmxsaWIucmVxdWVzdFxuaW1wb3J0IGJvdG8zXG5cbmxvZ2dlciA9IGxvZ2dpbmcuZ2V0TG9nZ2VyKClcbmxvZ2dlci5zZXRMZXZlbChsb2dnaW5nLklORk8pXG5cbmRlZiBzZW5kX2Nmbl9yZXNwb25zZShldmVudCwgc3RhdHVzLCBkYXRhPU5vbmUsIHJlYXNvbj1Ob25lLCBwaHlzaWNhbF9pZD1Ob25lKTpcbiAgICByZXNwb25zZV9ib2R5ID0ganNvbi5kdW1wcyh7XG4gICAgICAgICdTdGF0dXMnOiBzdGF0dXMsXG4gICAgICAgICdSZWFzb24nOiByZWFzb24gb3IgJ1NlZSBDbG91ZFdhdGNoIExvZ3MnLFxuICAgICAgICAnUGh5c2ljYWxSZXNvdXJjZUlkJzogcGh5c2ljYWxfaWQgb3IgZXZlbnQuZ2V0KCdQaHlzaWNhbFJlc291cmNlSWQnLCBldmVudFsnUmVxdWVzdElkJ10pLFxuICAgICAgICAnU3RhY2tJZCc6IGV2ZW50WydTdGFja0lkJ10sXG4gICAgICAgICdSZXF1ZXN0SWQnOiBldmVudFsnUmVxdWVzdElkJ10sXG4gICAgICAgICdMb2dpY2FsUmVzb3VyY2VJZCc6IGV2ZW50WydMb2dpY2FsUmVzb3VyY2VJZCddLFxuICAgICAgICAnRGF0YSc6IGRhdGEgb3Ige30sXG4gICAgfSlcbiAgICByZXNwb25zZV91cmwgPSBldmVudFsnUmVzcG9uc2VVUkwnXVxuICAgIGlmIG5vdCByZXNwb25zZV91cmwuc3RhcnRzd2l0aCgnaHR0cHM6Ly8nKTpcbiAgICAgICAgcmFpc2UgVmFsdWVFcnJvcihmJ0ludmFsaWQgcmVzcG9uc2UgVVJMIHNjaGVtZScpXG4gICAgcmVxID0gdXJsbGliLnJlcXVlc3QuUmVxdWVzdChcbiAgICAgICAgcmVzcG9uc2VfdXJsLFxuICAgICAgICBkYXRhPXJlc3BvbnNlX2JvZHkuZW5jb2RlKCd1dGYtOCcpLFxuICAgICAgICBoZWFkZXJzPXsnQ29udGVudC1UeXBlJzogJyd9LFxuICAgICAgICBtZXRob2Q9J1BVVCcsXG4gICAgKVxuICAgIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4ocmVxKVxuXG5kZWYgaGFuZGxlcihldmVudCwgY29udGV4dCk6XG4gICAgbG9nZ2VyLmluZm8oZidFdmVudDoge2pzb24uZHVtcHMoZXZlbnQpfScpXG4gICAgcmVxdWVzdF90eXBlID0gZXZlbnRbJ1JlcXVlc3RUeXBlJ11cbiAgICBwcm9wcyA9IGV2ZW50WydSZXNvdXJjZVByb3BlcnRpZXMnXVxuICAgIHByb3ZpZGVyX25hbWUgPSBwcm9wcy5nZXQoJ1Byb3ZpZGVyTmFtZScsICcnKVxuICAgIHJlZ2lvbiA9IHByb3BzLmdldCgnUmVnaW9uJywgJ3VzLWVhc3QtMScpXG4gICAgY2xpZW50ID0gYm90bzMuY2xpZW50KCdiZWRyb2NrLWFnZW50Y29yZS1jb250cm9sJywgcmVnaW9uX25hbWU9cmVnaW9uKVxuXG4gICAgaWYgcmVxdWVzdF90eXBlID09ICdEZWxldGUnOlxuICAgICAgICB0cnk6XG4gICAgICAgICAgICBjbGllbnQuZGVsZXRlX29hdXRoMl9jcmVkZW50aWFsX3Byb3ZpZGVyKG5hbWU9cHJvdmlkZXJfbmFtZSlcbiAgICAgICAgICAgIHNlbmRfY2ZuX3Jlc3BvbnNlKGV2ZW50LCAnU1VDQ0VTUycpXG4gICAgICAgIGV4Y2VwdCBFeGNlcHRpb246XG4gICAgICAgICAgICBzZW5kX2Nmbl9yZXNwb25zZShldmVudCwgJ1NVQ0NFU1MnKVxuICAgICAgICByZXR1cm5cblxuICAgIHRyeTpcbiAgICAgICAgcmVzcG9uc2UgPSBjbGllbnQuY3JlYXRlX29hdXRoMl9jcmVkZW50aWFsX3Byb3ZpZGVyKFxuICAgICAgICAgICAgbmFtZT1wcm92aWRlcl9uYW1lLFxuICAgICAgICAgICAgY3JlZGVudGlhbFByb3ZpZGVyVmVuZG9yPSdDdXN0b21PYXV0aDInLFxuICAgICAgICAgICAgb2F1dGgyUHJvdmlkZXJDb25maWdJbnB1dD17XG4gICAgICAgICAgICAgICAgJ2N1c3RvbU9hdXRoMlByb3ZpZGVyQ29uZmlnJzoge1xuICAgICAgICAgICAgICAgICAgICAnb2F1dGhEaXNjb3ZlcnknOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAnZGlzY292ZXJ5VXJsJzogcHJvcHMuZ2V0KCdEaXNjb3ZlcnlVcmwnLCAnJyksXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICdjbGllbnRJZCc6IHByb3BzLmdldCgnQ2xpZW50SWQnLCAnJyksXG4gICAgICAgICAgICAgICAgICAgICdjbGllbnRTZWNyZXQnOiBwcm9wcy5nZXQoJ0NsaWVudFNlY3JldCcsICcnKSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgKVxuICAgICAgICBwcm92aWRlcl9hcm4gPSByZXNwb25zZS5nZXQoJ2NyZWRlbnRpYWxQcm92aWRlckFybicsICcnKVxuICAgICAgICBzZWNyZXRfYXJuID0gcmVzcG9uc2UuZ2V0KCdjbGllbnRTZWNyZXRBcm4nLCB7fSkuZ2V0KCdzZWNyZXRBcm4nLCAnJylcbiAgICAgICAgbG9nZ2VyLmluZm8oZidDcmVhdGVkIHByb3ZpZGVyOiB7cHJvdmlkZXJfYXJufScpXG4gICAgICAgIHNlbmRfY2ZuX3Jlc3BvbnNlKGV2ZW50LCAnU1VDQ0VTUycsIGRhdGE9e1xuICAgICAgICAgICAgJ1Byb3ZpZGVyQXJuJzogcHJvdmlkZXJfYXJuLFxuICAgICAgICAgICAgJ1NlY3JldEFybic6IHNlY3JldF9hcm4sXG4gICAgICAgIH0sIHBoeXNpY2FsX2lkPXByb3ZpZGVyX25hbWUpXG4gICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOlxuICAgICAgICBsb2dnZXIuZXJyb3IoZidDcmVhdGUgZmFpbGVkOiB7ZX0nKVxuICAgICAgICBzZW5kX2Nmbl9yZXNwb25zZShldmVudCwgJ0ZBSUxFRCcsIHJlYXNvbj1zdHIoZSkpXG5gKSxcbiAgICB9KTtcblxuICAgIG9hdXRoUHJvdmlkZXJGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6Q3JlYXRlT2F1dGgyQ3JlZGVudGlhbFByb3ZpZGVyJyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkRlbGV0ZU9hdXRoMkNyZWRlbnRpYWxQcm92aWRlcicsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRPYXV0aDJDcmVkZW50aWFsUHJvdmlkZXInLFxuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6Q3JlYXRlVG9rZW5WYXVsdCcsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRUb2tlblZhdWx0JyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIG9hdXRoUHJvdmlkZXJGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnc2VjcmV0c21hbmFnZXI6Q3JlYXRlU2VjcmV0JyxcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkRlbGV0ZVNlY3JldCcsXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpQdXRTZWNyZXRWYWx1ZScsXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpUYWdSZXNvdXJjZScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOnNlY3JldHNtYW5hZ2VyOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpzZWNyZXQ6YmVkcm9jay1hZ2VudGNvcmUtaWRlbnRpdHkqYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgY29uc3Qgb2F1dGhQcm92aWRlciA9IG5ldyBjZGsuQ3VzdG9tUmVzb3VyY2UodGhpcywgJ09BdXRoUHJvdmlkZXInLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IG9hdXRoUHJvdmlkZXJGbi5mdW5jdGlvbkFybixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgUHJvdmlkZXJOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tb2F1dGgtcHJvdmlkZXJgLFxuICAgICAgICBEaXNjb3ZlcnlVcmw6IGBodHRwczovL2NvZ25pdG8taWRwLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vJHtwcm9wcy5hdXRoVXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICBDbGllbnRJZDogcHJvcHMuYXV0aE0ybUNsaWVudElkLFxuICAgICAgICBDbGllbnRTZWNyZXQ6IG0ybUNsaWVudFNlY3JldCxcbiAgICAgICAgUmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBvYXV0aFByb3ZpZGVyQXJuID0gb2F1dGhQcm92aWRlci5nZXRBdHRTdHJpbmcoJ1Byb3ZpZGVyQXJuJyk7XG4gICAgY29uc3Qgb2F1dGhTZWNyZXRBcm4gPSBvYXV0aFByb3ZpZGVyLmdldEF0dFN0cmluZygnU2VjcmV0QXJuJyk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRGVmYXVsdCBQb2xpY3kgb24gR2F0ZXdheSBSb2xlIChzY29wZWQgdG8gT0F1dGggcHJvdmlkZXIgcmVzb3VyY2VzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGdhdGV3YXlSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldFJlc291cmNlT2F1dGgyVG9rZW4nLFxuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6R2V0V29ya2xvYWRBY2Nlc3NUb2tlbicsXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZScsXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpEZXNjcmliZVNlY3JldCcsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbb2F1dGhQcm92aWRlckFybiwgb2F1dGhTZWNyZXRBcm5dLFxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBHYXRld2F5IChBV1NfSUFNIGF1dGgg4oCUIE1haW4gUnVudGltZSBjYWxscyB2aWEgSW52b2tlR2F0ZXdheSBBUEkpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgZ2F0ZXdheSA9IG5ldyBjZGsuQ2ZuUmVzb3VyY2UodGhpcywgJ01jcEdhdGV3YXknLCB7XG4gICAgICB0eXBlOiAnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpHYXRld2F5JyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgTmFtZTogJ2Zpbm9wcy1nYXRld2F5JyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdGaW5PcHMgR2F0ZXdheSBmb3IgYmlsbGluZyBhbmQgcHJpY2luZyBNQ1AgdG9vbHMgKElBTSBhdXRoKScsXG4gICAgICAgIFByb3RvY29sVHlwZTogJ01DUCcsXG4gICAgICAgIEF1dGhvcml6ZXJUeXBlOiAnQVdTX0lBTScsXG4gICAgICAgIFByb3RvY29sQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIE1jcDoge1xuICAgICAgICAgICAgSW5zdHJ1Y3Rpb25zOiAnRmluT3BzIGdhdGV3YXkgZm9yIGJpbGxpbmcgYW5kIHByaWNpbmcgTUNQIHRvb2xzJyxcbiAgICAgICAgICAgIFNlYXJjaFR5cGU6ICdTRU1BTlRJQycsXG4gICAgICAgICAgICBTdXBwb3J0ZWRWZXJzaW9uczogWycyMDI1LTAzLTI2J10sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgUm9sZUFybjogZ2F0ZXdheVJvbGUucm9sZUFybixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZ2F0ZXdheS5ub2RlLmFkZERlcGVuZGVuY3kob2F1dGhQcm92aWRlcik7XG5cbiAgICB0aGlzLmdhdGV3YXlBcm4gPSBnYXRld2F5LmdldEF0dCgnR2F0ZXdheUFybicpLnRvU3RyaW5nKCk7XG4gICAgY29uc3QgZ2F0ZXdheUlkID0gZ2F0ZXdheS5nZXRBdHQoJ0dhdGV3YXlJZGVudGlmaWVyJykudG9TdHJpbmcoKTtcbiAgICB0aGlzLmdhdGV3YXlVcmwgPSBnYXRld2F5LmdldEF0dCgnR2F0ZXdheVVybCcpLnRvU3RyaW5nKCk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gR2F0ZXdheSBUYXJnZXRzIChNQ1AgU2VydmVyIGVuZHBvaW50cylcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBiaWxsaW5nVGFyZ2V0ID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnQmlsbGluZ01jcFRhcmdldCcsIHtcbiAgICAgIHR5cGU6ICdBV1M6OkJlZHJvY2tBZ2VudENvcmU6OkdhdGV3YXlUYXJnZXQnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBHYXRld2F5SWRlbnRpZmllcjogZ2F0ZXdheUlkLFxuICAgICAgICBOYW1lOiAnYmlsbGluZ01jcCcsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQVdTIExhYnMgQmlsbGluZyBNQ1AgU2VydmVyIG9uIEFnZW50Q29yZSBSdW50aW1lJyxcbiAgICAgICAgVGFyZ2V0Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIE1jcDogeyBNY3BTZXJ2ZXI6IHsgRW5kcG9pbnQ6IHByb3BzLmJpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQgfSB9LFxuICAgICAgICB9LFxuICAgICAgICBDcmVkZW50aWFsUHJvdmlkZXJDb25maWd1cmF0aW9uczogW3tcbiAgICAgICAgICBDcmVkZW50aWFsUHJvdmlkZXJUeXBlOiAnT0FVVEgnLFxuICAgICAgICAgIENyZWRlbnRpYWxQcm92aWRlcjoge1xuICAgICAgICAgICAgT2F1dGhDcmVkZW50aWFsUHJvdmlkZXI6IHtcbiAgICAgICAgICAgICAgUHJvdmlkZXJBcm46IG9hdXRoUHJvdmlkZXJBcm4sXG4gICAgICAgICAgICAgIFNjb3BlczogWydtY3AtcnVudGltZS1zZXJ2ZXIvaW52b2tlJ10sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH1dLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBiaWxsaW5nVGFyZ2V0Lm5vZGUuYWRkRGVwZW5kZW5jeShnYXRld2F5KTtcblxuICAgIGNvbnN0IHByaWNpbmdUYXJnZXQgPSBuZXcgY2RrLkNmblJlc291cmNlKHRoaXMsICdQcmljaW5nTWNwVGFyZ2V0Jywge1xuICAgICAgdHlwZTogJ0FXUzo6QmVkcm9ja0FnZW50Q29yZTo6R2F0ZXdheVRhcmdldCcsXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIEdhdGV3YXlJZGVudGlmaWVyOiBnYXRld2F5SWQsXG4gICAgICAgIE5hbWU6ICdwcmljaW5nTWNwJyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdBV1MgTGFicyBQcmljaW5nIE1DUCBTZXJ2ZXIgb24gQWdlbnRDb3JlIFJ1bnRpbWUnLFxuICAgICAgICBUYXJnZXRDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgTWNwOiB7IE1jcFNlcnZlcjogeyBFbmRwb2ludDogcHJvcHMucHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCB9IH0sXG4gICAgICAgIH0sXG4gICAgICAgIENyZWRlbnRpYWxQcm92aWRlckNvbmZpZ3VyYXRpb25zOiBbe1xuICAgICAgICAgIENyZWRlbnRpYWxQcm92aWRlclR5cGU6ICdPQVVUSCcsXG4gICAgICAgICAgQ3JlZGVudGlhbFByb3ZpZGVyOiB7XG4gICAgICAgICAgICBPYXV0aENyZWRlbnRpYWxQcm92aWRlcjoge1xuICAgICAgICAgICAgICBQcm92aWRlckFybjogb2F1dGhQcm92aWRlckFybixcbiAgICAgICAgICAgICAgU2NvcGVzOiBbJ21jcC1ydW50aW1lLXNlcnZlci9pbnZva2UnXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfV0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHByaWNpbmdUYXJnZXQubm9kZS5hZGREZXBlbmRlbmN5KGdhdGV3YXkpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0ZXdheUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmdhdGV3YXlBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FnZW50Q29yZSBHYXRld2F5IEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tR2F0ZXdheUFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2F0ZXdheVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmdhdGV3YXlVcmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FnZW50Q29yZSBHYXRld2F5IFVSTCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tR2F0ZXdheVVybGAsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ0RLLU5hZyBTdXBwcmVzc2lvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoZ2F0ZXdheVJvbGUsIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsIHJlYXNvbjogJ1dpbGRjYXJkIGZvciBBZ2VudENvcmUgSWRlbnRpdHkgdG9rZW4gZXhjaGFuZ2UgYW5kIE9BdXRoIHByb3ZpZGVyIG1hbmFnZW1lbnQuJyB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKG9hdXRoUHJvdmlkZXJGbiwgW1xuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnV2lsZGNhcmQgcmVxdWlyZWQgZm9yIEFnZW50Q29yZSBJZGVudGl0eSB0b2tlbiB2YXVsdCBjcmVhdGlvbiBhbmQgYmVkcm9jay1hZ2VudGNvcmUtaWRlbnRpdHkgc2VjcmV0cyBuYW1lc3BhY2UuJyB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFN0YWNrU3VwcHJlc3Npb25zKHRoaXMsIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsIHJlYXNvbjogJ0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBpcyBBV1MgYmVzdCBwcmFjdGljZS4nLCBhcHBsaWVzVG86IFsnUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSddIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLCByZWFzb246ICdXaWxkY2FyZCBmb3IgQWdlbnRDb3JlIElkZW50aXR5IHRva2VuIGV4Y2hhbmdlLCBPQXV0aCBjcmVkZW50aWFsIHByb3ZpZGVyIG1hbmFnZW1lbnQuJywgYXBwbGllc1RvOiBbJ1Jlc291cmNlOjoqJ10gfSxcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtTDEnLCByZWFzb246ICdMYW1iZGEgcnVudGltZSB2ZXJzaW9uIG1hbmFnZWQgYnkgQ0RLLicgfSxcbiAgICBdKTtcbiAgfVxufVxuIl19