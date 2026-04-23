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
exports.MCPRuntimeStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const cdk_nag_1 = require("cdk-nag");
class MCPRuntimeStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========================================
        // IAM Roles for MCP Runtimes
        // ========================================
        // Billing MCP Server Runtime Role
        const billingMcpRuntimeRole = new iam.Role(this, 'BillingMcpRuntimeRole', {
            roleName: `${this.stackName}-BillingMcpRuntimeRole`,
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Pricing MCP Server Runtime Role
        const pricingMcpRuntimeRole = new iam.Role(this, 'PricingMcpRuntimeRole', {
            roleName: `${this.stackName}-PricingMcpRuntimeRole`,
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Common AgentCore Runtime permissions (ECR, CloudWatch, X-Ray, Bedrock, Gateway)
        const commonRuntimePermissions = [
            // ECR token access
            new iam.PolicyStatement({
                sid: 'ECRTokenAccess',
                effect: iam.Effect.ALLOW,
                actions: ['ecr:GetAuthorizationToken'],
                resources: ['*'],
            }),
            // CloudWatch Logs
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:DescribeLogGroups'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
            }),
            // Gateway invocation
            new iam.PolicyStatement({
                sid: 'AllowGatewayInvocation',
                effect: iam.Effect.ALLOW,
                actions: ['bedrock-agentcore:InvokeGateway'],
                resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`],
            }),
        ];
        // Add common permissions to both roles
        for (const stmt of commonRuntimePermissions) {
            billingMcpRuntimeRole.addToPolicy(stmt);
            pricingMcpRuntimeRole.addToPolicy(stmt);
        }
        // ECR image pull for each role's specific repository
        props.billingMcpRepository.grantPull(billingMcpRuntimeRole);
        props.pricingMcpRepository.grantPull(pricingMcpRuntimeRole);
        // Add Cost Explorer and billing permissions to Billing MCP Runtime
        billingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ce:*',
                'budgets:*',
                'compute-optimizer:*',
                'freetier:*',
                'cost-optimization-hub:*',
                'pricing:GetProducts',
                'pricing:GetAttributeValues',
                'pricing:DescribeServices',
                'pricing:ListPriceListFiles',
                'pricing:GetPriceListFileUrl',
                'ec2:DescribeInstances',
                'ec2:DescribeVolumes',
                'ec2:DescribeInstanceTypes',
                'ec2:DescribeRegions',
                'autoscaling:DescribeAutoScalingGroups',
                'lambda:ListFunctions',
                'lambda:GetFunction',
                'ecs:ListClusters',
                'ecs:ListServices',
                'ecs:DescribeServices',
            ],
            resources: ['*'],
        }));
        // Add Pricing API permissions to Pricing MCP Runtime
        pricingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'pricing:GetProducts',
                'pricing:GetAttributeValues',
                'pricing:DescribeServices',
                'pricing:ListPriceListFiles',
                'pricing:GetPriceListFileUrl',
            ],
            resources: ['*'],
        }));
        // ========================================
        // MCP Runtimes with JWT Authorization
        // Gateway sends OAuth Bearer tokens, Runtimes validate JWT
        // ========================================
        // Billing MCP Server Runtime
        const cfnBillingMcpRuntime = new cdk.CfnResource(this, 'BillingMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'finops_billing_mcp_jwt_v1',
                Description: 'AWS Labs Billing MCP Server Runtime with JWT authorization',
                RoleArn: billingMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.billingMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnBillingMcpRuntime.node.addDependency(billingMcpRuntimeRole);
        this.billingMcpRuntimeArn = cfnBillingMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
        const encodedBillingArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.billingMcpRuntimeArn)))),
        ]);
        this.billingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedBillingArn}/invocations?qualifier=DEFAULT`;
        // Pricing MCP Server Runtime
        const cfnPricingMcpRuntime = new cdk.CfnResource(this, 'PricingMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'finops_pricing_mcp_jwt_v1',
                Description: 'AWS Labs Pricing MCP Server Runtime with JWT authorization',
                RoleArn: pricingMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.pricingMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnPricingMcpRuntime.node.addDependency(pricingMcpRuntimeRole);
        this.pricingMcpRuntimeArn = cfnPricingMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
        const encodedPricingArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.pricingMcpRuntimeArn)))),
        ]);
        this.pricingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedPricingArn}/invocations?qualifier=DEFAULT`;
        // ========================================
        // Outputs
        // ========================================
        new cdk.CfnOutput(this, 'BillingMcpRuntimeArn', {
            value: this.billingMcpRuntimeArn,
            description: 'Billing MCP Server Runtime ARN',
            exportName: `${this.stackName}-BillingMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'BillingMcpRuntimeEndpoint', {
            value: this.billingMcpRuntimeEndpoint,
            description: 'Billing MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-BillingMcpRuntimeEndpoint`,
        });
        new cdk.CfnOutput(this, 'PricingMcpRuntimeArn', {
            value: this.pricingMcpRuntimeArn,
            description: 'Pricing MCP Server Runtime ARN',
            exportName: `${this.stackName}-PricingMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'PricingMcpRuntimeEndpoint', {
            value: this.pricingMcpRuntimeEndpoint,
            description: 'Pricing MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-PricingMcpRuntimeEndpoint`,
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(billingMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for Cost Explorer APIs (account-level services), ECR auth token, CloudWatch, X-Ray',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(pricingMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for AWS Pricing API (global service), ECR auth token, CloudWatch, X-Ray',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-L1',
                reason: 'Python 3.14 is the latest Lambda runtime version available',
            },
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions',
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for custom resource Lambda functions',
            },
        ]);
    }
}
exports.MCPRuntimeStack = MCPRuntimeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXJ1bnRpbWUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJtY3AtcnVudGltZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMseURBQTJDO0FBRzNDLHFDQUEwQztBQVUxQyxNQUFhLGVBQWdCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFNNUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEyQjtRQUNuRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QiwyQ0FBMkM7UUFDM0MsNkJBQTZCO1FBQzdCLDJDQUEyQztRQUUzQyxrQ0FBa0M7UUFDbEMsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQ3hFLFFBQVEsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLHdCQUF3QjtZQUNuRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsaUNBQWlDLENBQUM7U0FDdkUsQ0FBQyxDQUFDO1FBRUgsa0NBQWtDO1FBQ2xDLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUN4RSxRQUFRLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyx3QkFBd0I7WUFDbkQsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLGlDQUFpQyxDQUFDO1NBQ3ZFLENBQUMsQ0FBQztRQUVILGtGQUFrRjtRQUNsRixNQUFNLHdCQUF3QixHQUEwQjtZQUN0RCxtQkFBbUI7WUFDbkIsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dCQUN0QixHQUFHLEVBQUUsZ0JBQWdCO2dCQUNyQixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dCQUN4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LFVBQVUsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLDRCQUE0QjtTQUMxRCxDQUFDLENBQUM7UUFFSCwyQ0FBMkM7UUFDM0MsdUJBQXVCO1FBQ3ZCLDJDQUEyQztRQUUzQyx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLHFCQUFxQixFQUFFO1lBQzdEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxrSEFBa0g7YUFDM0g7U0FDRixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxxQkFBcUIsRUFBRTtZQUM3RDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsdUdBQXVHO2FBQ2hIO1NBQ0YsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVULHlCQUFlLENBQUMsb0JBQW9CLENBQUMsSUFBSSxFQUFFO1lBQ3pDO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw0REFBNEQ7YUFDckU7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsc0ZBQXNGO2FBQy9GO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG9FQUFvRTthQUM3RTtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXhSRCwwQ0F3UkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcblxuZXhwb3J0IGludGVyZmFjZSBNQ1BSdW50aW1lU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgYmlsbGluZ01jcFJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgcHJpY2luZ01jcFJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgLy8gRnJvbSBBdXRoU3RhY2sgLSBmb3IgSldUIGF1dGhvcml6YXRpb24gb24gcnVudGltZXNcbiAgdXNlclBvb2xJZDogc3RyaW5nO1xuICBtMm1DbGllbnRJZDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgTUNQUnVudGltZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGJpbGxpbmdNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBwcmljaW5nTWNwUnVudGltZUFybjogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgYmlsbGluZ01jcFJ1bnRpbWVFbmRwb2ludDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgcHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBNQ1BSdW50aW1lU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIElBTSBSb2xlcyBmb3IgTUNQIFJ1bnRpbWVzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQmlsbGluZyBNQ1AgU2VydmVyIFJ1bnRpbWUgUm9sZVxuICAgIGNvbnN0IGJpbGxpbmdNY3BSdW50aW1lUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQmlsbGluZ01jcFJ1bnRpbWVSb2xlJywge1xuICAgICAgcm9sZU5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1CaWxsaW5nTWNwUnVudGltZVJvbGVgLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcblxuICAgIC8vIFByaWNpbmcgTUNQIFNlcnZlciBSdW50aW1lIFJvbGVcbiAgICBjb25zdCBwcmljaW5nTWNwUnVudGltZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1ByaWNpbmdNY3BSdW50aW1lUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tUHJpY2luZ01jcFJ1bnRpbWVSb2xlYCxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdiZWRyb2NrLWFnZW50Y29yZS5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG5cbiAgICAvLyBDb21tb24gQWdlbnRDb3JlIFJ1bnRpbWUgcGVybWlzc2lvbnMgKEVDUiwgQ2xvdWRXYXRjaCwgWC1SYXksIEJlZHJvY2ssIEdhdGV3YXkpXG4gICAgY29uc3QgY29tbW9uUnVudGltZVBlcm1pc3Npb25zOiBpYW0uUG9saWN5U3RhdGVtZW50W10gPSBbXG4gICAgICAvLyBFQ1IgdG9rZW4gYWNjZXNzXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0VDUlRva2VuQWNjZXNzJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pLFxuICAgICAgLy8gQ2xvdWRXYXRjaCBMb2dzXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydsb2dzOkRlc2NyaWJlTG9nR3JvdXBzJ10sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDoqYF0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJywgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvYmVkcm9jay1hZ2VudGNvcmUvcnVudGltZXMvKmBdLFxuICAgICAgfSksXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsICdsb2dzOlB1dExvZ0V2ZW50cyddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS9ydW50aW1lcy8qOmxvZy1zdHJlYW06KmBdLFxuICAgICAgfSksXG4gICAgICAvLyBHYXRld2F5IGludm9jYXRpb25cbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnQWxsb3dHYXRld2F5SW52b2NhdGlvbicsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydiZWRyb2NrLWFnZW50Y29yZTpJbnZva2VHYXRld2F5J10sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpnYXRld2F5LypgXSxcbiAgICAgIH0pLFxuICAgIF07XG5cbiAgICAvLyBBZGQgY29tbW9uIHBlcm1pc3Npb25zIHRvIGJvdGggcm9sZXNcbiAgICBmb3IgKGNvbnN0IHN0bXQgb2YgY29tbW9uUnVudGltZVBlcm1pc3Npb25zKSB7XG4gICAgICBiaWxsaW5nTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3koc3RtdCk7XG4gICAgICBwcmljaW5nTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3koc3RtdCk7XG4gICAgfVxuXG4gICAgLy8gRUNSIGltYWdlIHB1bGwgZm9yIGVhY2ggcm9sZSdzIHNwZWNpZmljIHJlcG9zaXRvcnlcbiAgICBwcm9wcy5iaWxsaW5nTWNwUmVwb3NpdG9yeS5ncmFudFB1bGwoYmlsbGluZ01jcFJ1bnRpbWVSb2xlKTtcbiAgICBwcm9wcy5wcmljaW5nTWNwUmVwb3NpdG9yeS5ncmFudFB1bGwocHJpY2luZ01jcFJ1bnRpbWVSb2xlKTtcblxuICAgIC8vIEFkZCBDb3N0IEV4cGxvcmVyIGFuZCBiaWxsaW5nIHBlcm1pc3Npb25zIHRvIEJpbGxpbmcgTUNQIFJ1bnRpbWVcbiAgICBiaWxsaW5nTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnY2U6KicsXG4gICAgICAgICdidWRnZXRzOionLFxuICAgICAgICAnY29tcHV0ZS1vcHRpbWl6ZXI6KicsXG4gICAgICAgICdmcmVldGllcjoqJyxcbiAgICAgICAgJ2Nvc3Qtb3B0aW1pemF0aW9uLWh1YjoqJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJvZHVjdHMnLFxuICAgICAgICAncHJpY2luZzpHZXRBdHRyaWJ1dGVWYWx1ZXMnLFxuICAgICAgICAncHJpY2luZzpEZXNjcmliZVNlcnZpY2VzJyxcbiAgICAgICAgJ3ByaWNpbmc6TGlzdFByaWNlTGlzdEZpbGVzJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJpY2VMaXN0RmlsZVVybCcsXG4gICAgICAgICdlYzI6RGVzY3JpYmVJbnN0YW5jZXMnLFxuICAgICAgICAnZWMyOkRlc2NyaWJlVm9sdW1lcycsXG4gICAgICAgICdlYzI6RGVzY3JpYmVJbnN0YW5jZVR5cGVzJyxcbiAgICAgICAgJ2VjMjpEZXNjcmliZVJlZ2lvbnMnLFxuICAgICAgICAnYXV0b3NjYWxpbmc6RGVzY3JpYmVBdXRvU2NhbGluZ0dyb3VwcycsXG4gICAgICAgICdsYW1iZGE6TGlzdEZ1bmN0aW9ucycsXG4gICAgICAgICdsYW1iZGE6R2V0RnVuY3Rpb24nLFxuICAgICAgICAnZWNzOkxpc3RDbHVzdGVycycsXG4gICAgICAgICdlY3M6TGlzdFNlcnZpY2VzJyxcbiAgICAgICAgJ2VjczpEZXNjcmliZVNlcnZpY2VzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBQcmljaW5nIEFQSSBwZXJtaXNzaW9ucyB0byBQcmljaW5nIE1DUCBSdW50aW1lXG4gICAgcHJpY2luZ01jcFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJvZHVjdHMnLFxuICAgICAgICAncHJpY2luZzpHZXRBdHRyaWJ1dGVWYWx1ZXMnLFxuICAgICAgICAncHJpY2luZzpEZXNjcmliZVNlcnZpY2VzJyxcbiAgICAgICAgJ3ByaWNpbmc6TGlzdFByaWNlTGlzdEZpbGVzJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJpY2VMaXN0RmlsZVVybCcsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTUNQIFJ1bnRpbWVzIHdpdGggSldUIEF1dGhvcml6YXRpb25cbiAgICAvLyBHYXRld2F5IHNlbmRzIE9BdXRoIEJlYXJlciB0b2tlbnMsIFJ1bnRpbWVzIHZhbGlkYXRlIEpXVFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIEJpbGxpbmcgTUNQIFNlcnZlciBSdW50aW1lXG4gICAgY29uc3QgY2ZuQmlsbGluZ01jcFJ1bnRpbWUgPSBuZXcgY2RrLkNmblJlc291cmNlKHRoaXMsICdCaWxsaW5nTWNwUnVudGltZScsIHtcbiAgICAgIHR5cGU6ICdBV1M6OkJlZHJvY2tBZ2VudENvcmU6OlJ1bnRpbWUnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBBZ2VudFJ1bnRpbWVOYW1lOiAnZmlub3BzX2JpbGxpbmdfbWNwX2p3dF92MScsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQVdTIExhYnMgQmlsbGluZyBNQ1AgU2VydmVyIFJ1bnRpbWUgd2l0aCBKV1QgYXV0aG9yaXphdGlvbicsXG4gICAgICAgIFJvbGVBcm46IGJpbGxpbmdNY3BSdW50aW1lUm9sZS5yb2xlQXJuLFxuICAgICAgICBBdXRob3JpemVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIEN1c3RvbUpXVEF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIEFsbG93ZWRDbGllbnRzOiBbcHJvcHMubTJtQ2xpZW50SWRdLFxuICAgICAgICAgICAgRGlzY292ZXJ5VXJsOiBgaHR0cHM6Ly9jb2duaXRvLWlkcC4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cHJvcHMudXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgQWdlbnRSdW50aW1lQXJ0aWZhY3Q6IHtcbiAgICAgICAgICBDb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJVcmk6IGAke3Byb3BzLmJpbGxpbmdNY3BSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGBcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIE5ldHdvcmtDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgTmV0d29ya01vZGU6ICdQVUJMSUMnXG4gICAgICAgIH0sXG4gICAgICAgIEVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgQVdTX1JFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgICAgREVQTE9ZTUVOVF9USU1FU1RBTVA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSxcbiAgICAgICAgUHJvdG9jb2xDb25maWd1cmF0aW9uOiAnTUNQJyxcbiAgICAgICAgTGlmZWN5Y2xlQ29uZmlndXJhdGlvbjoge30sXG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgY2ZuQmlsbGluZ01jcFJ1bnRpbWUubm9kZS5hZGREZXBlbmRlbmN5KGJpbGxpbmdNY3BSdW50aW1lUm9sZSk7XG5cbiAgICB0aGlzLmJpbGxpbmdNY3BSdW50aW1lQXJuID0gY2ZuQmlsbGluZ01jcFJ1bnRpbWUuZ2V0QXR0KCdBZ2VudFJ1bnRpbWVBcm4nKS50b1N0cmluZygpO1xuICAgIC8vIE1DUCBSdW50aW1lIGVuZHBvaW50IGZvcm1hdCBmb3IgQWdlbnRDb3JlIEdhdGV3YXkgdGFyZ2V0cyAoZnJvbSBBV1MgZG9jdW1lbnRhdGlvbilcbiAgICAvLyBGb3JtYXQ6IGh0dHBzOi8vYmVkcm9jay1hZ2VudGNvcmUue3JlZ2lvbn0uYW1hem9uYXdzLmNvbS9ydW50aW1lcy97RU5DT0RFRF9BUk59L2ludm9jYXRpb25zP3F1YWxpZmllcj1ERUZBVUxUXG4gICAgLy8gVGhlIEFSTiBtdXN0IGJlIFVSTC1lbmNvZGVkICg6IOKGkiAlM0EsIC8g4oaSICUyRilcbiAgICAvLyBSZWZlcmVuY2U6IGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9iZWRyb2NrLWFnZW50Y29yZS9sYXRlc3QvZGV2Z3VpZGUvcnVudGltZS1tY3AuaHRtbFxuICAgIGNvbnN0IGVuY29kZWRCaWxsaW5nQXJuID0gY2RrLkZuLmpvaW4oJycsIFtcbiAgICAgIGNkay5Gbi5zZWxlY3QoMCwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDEsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuYmlsbGluZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmJpbGxpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMywgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDQsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuYmlsbGluZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLmpvaW4oJyUyRicsIGNkay5Gbi5zcGxpdCgnLycsIGNkay5Gbi5zZWxlY3QoNSwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpKSksXG4gICAgXSk7XG4gICAgdGhpcy5iaWxsaW5nTWNwUnVudGltZUVuZHBvaW50ID0gYGh0dHBzOi8vYmVkcm9jay1hZ2VudGNvcmUuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS9ydW50aW1lcy8ke2VuY29kZWRCaWxsaW5nQXJufS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVGA7XG5cbiAgICAvLyBQcmljaW5nIE1DUCBTZXJ2ZXIgUnVudGltZVxuICAgIGNvbnN0IGNmblByaWNpbmdNY3BSdW50aW1lID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnUHJpY2luZ01jcFJ1bnRpbWUnLCB7XG4gICAgICB0eXBlOiAnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpSdW50aW1lJyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgQWdlbnRSdW50aW1lTmFtZTogJ2Zpbm9wc19wcmljaW5nX21jcF9qd3RfdjEnLFxuICAgICAgICBEZXNjcmlwdGlvbjogJ0FXUyBMYWJzIFByaWNpbmcgTUNQIFNlcnZlciBSdW50aW1lIHdpdGggSldUIGF1dGhvcml6YXRpb24nLFxuICAgICAgICBSb2xlQXJuOiBwcmljaW5nTWNwUnVudGltZVJvbGUucm9sZUFybixcbiAgICAgICAgQXV0aG9yaXplckNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBDdXN0b21KV1RBdXRob3JpemVyOiB7XG4gICAgICAgICAgICBBbGxvd2VkQ2xpZW50czogW3Byb3BzLm0ybUNsaWVudElkXSxcbiAgICAgICAgICAgIERpc2NvdmVyeVVybDogYGh0dHBzOi8vY29nbml0by1pZHAuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3Byb3BzLnVzZXJQb29sSWR9Ly53ZWxsLWtub3duL29wZW5pZC1jb25maWd1cmF0aW9uYCxcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIEFnZW50UnVudGltZUFydGlmYWN0OiB7XG4gICAgICAgICAgQ29udGFpbmVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgQ29udGFpbmVyVXJpOiBgJHtwcm9wcy5wcmljaW5nTWNwUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfTpsYXRlc3RgXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBOZXR3b3JrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIE5ldHdvcmtNb2RlOiAnUFVCTElDJ1xuICAgICAgICB9LFxuICAgICAgICBFbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgIEFXU19SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgICAgIERFUExPWU1FTlRfVElNRVNUQU1QOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0sXG4gICAgICAgIFByb3RvY29sQ29uZmlndXJhdGlvbjogJ01DUCcsXG4gICAgICAgIExpZmVjeWNsZUNvbmZpZ3VyYXRpb246IHt9LFxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIGNmblByaWNpbmdNY3BSdW50aW1lLm5vZGUuYWRkRGVwZW5kZW5jeShwcmljaW5nTWNwUnVudGltZVJvbGUpO1xuXG4gICAgdGhpcy5wcmljaW5nTWNwUnVudGltZUFybiA9IGNmblByaWNpbmdNY3BSdW50aW1lLmdldEF0dCgnQWdlbnRSdW50aW1lQXJuJykudG9TdHJpbmcoKTtcbiAgICAvLyBNQ1AgUnVudGltZSBlbmRwb2ludCBmb3JtYXQgZm9yIEFnZW50Q29yZSBHYXRld2F5IHRhcmdldHMgKGZyb20gQVdTIGRvY3VtZW50YXRpb24pXG4gICAgLy8gRm9ybWF0OiBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLntyZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMve0VOQ09ERURfQVJOfS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVFxuICAgIC8vIFRoZSBBUk4gbXVzdCBiZSBVUkwtZW5jb2RlZCAoOiDihpIgJTNBLCAvIOKGkiAlMkYpXG4gICAgLy8gUmVmZXJlbmNlOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vYmVkcm9jay1hZ2VudGNvcmUvbGF0ZXN0L2Rldmd1aWRlL3J1bnRpbWUtbWNwLmh0bWxcbiAgICBjb25zdCBlbmNvZGVkUHJpY2luZ0FybiA9IGNkay5Gbi5qb2luKCcnLCBbXG4gICAgICBjZGsuRm4uc2VsZWN0KDAsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgxLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLnByaWNpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMiwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5wcmljaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDMsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCg0LCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLnByaWNpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5qb2luKCclMkYnLCBjZGsuRm4uc3BsaXQoJy8nLCBjZGsuRm4uc2VsZWN0KDUsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSkpLFxuICAgIF0pO1xuICAgIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCA9IGBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMvJHtlbmNvZGVkUHJpY2luZ0Fybn0vaW52b2NhdGlvbnM/cXVhbGlmaWVyPURFRkFVTFRgO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmlsbGluZ01jcFJ1bnRpbWVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmlsbGluZyBNQ1AgU2VydmVyIFJ1bnRpbWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1CaWxsaW5nTWNwUnVudGltZUFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmlsbGluZ01jcFJ1bnRpbWVFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmJpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0JpbGxpbmcgTUNQIFNlcnZlciBSdW50aW1lIEVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1CaWxsaW5nTWNwUnVudGltZUVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQcmljaW5nTWNwUnVudGltZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnByaWNpbmdNY3BSdW50aW1lQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdQcmljaW5nIE1DUCBTZXJ2ZXIgUnVudGltZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LVByaWNpbmdNY3BSdW50aW1lQXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQcmljaW5nTWNwUnVudGltZUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMucHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHJpY2luZyBNQ1AgU2VydmVyIFJ1bnRpbWUgRW5kcG9pbnQnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LVByaWNpbmdNY3BSdW50aW1lRW5kcG9pbnRgLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENESy1OYWcgU3VwcHJlc3Npb25zXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGJpbGxpbmdNY3BSdW50aW1lUm9sZSwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIENvc3QgRXhwbG9yZXIgQVBJcyAoYWNjb3VudC1sZXZlbCBzZXJ2aWNlcyksIEVDUiBhdXRoIHRva2VuLCBDbG91ZFdhdGNoLCBYLVJheScsXG4gICAgICB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHByaWNpbmdNY3BSdW50aW1lUm9sZSwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIEFXUyBQcmljaW5nIEFQSSAoZ2xvYmFsIHNlcnZpY2UpLCBFQ1IgYXV0aCB0b2tlbiwgQ2xvdWRXYXRjaCwgWC1SYXknLFxuICAgICAgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyh0aGlzLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUwxJyxcbiAgICAgICAgcmVhc29uOiAnUHl0aG9uIDMuMTQgaXMgdGhlIGxhdGVzdCBMYW1iZGEgcnVudGltZSB2ZXJzaW9uIGF2YWlsYWJsZScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgcmVhc29uOiAnQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlIG1hbmFnZWQgcG9saWN5IGlzIEFXUyBiZXN0IHByYWN0aWNlIGZvciBMYW1iZGEgZnVuY3Rpb25zJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdXaWxkY2FyZCBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgY3VzdG9tIHJlc291cmNlIExhbWJkYSBmdW5jdGlvbnMnLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxufVxuIl19