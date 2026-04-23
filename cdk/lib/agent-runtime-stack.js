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
exports.AgentRuntimeStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const agentcore = __importStar(require("@aws-cdk/aws-bedrock-agentcore-alpha"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const cdk_nag_1 = require("cdk-nag");
class AgentRuntimeStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const foundationModel = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
        // ========================================
        // IAM Roles
        // ========================================
        // Main Runtime Role
        const runtimeRole = new iam.Role(this, 'RuntimeRole', {
            roleName: `${this.stackName}-RuntimeRole`,
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // ECR token access
        runtimeRole.addToPolicy(new iam.PolicyStatement({
            sid: 'ECRTokenAccess',
            effect: iam.Effect.ALLOW,
            actions: ['ecr:GetAuthorizationToken'],
            resources: ['*'],
        }));
        // CloudWatch Logs
        runtimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['logs:DescribeLogGroups'],
            resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
        }));
        runtimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
            resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
        }));
        runtimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
        }));
        // Add Bedrock model permissions to Main Runtime
        runtimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
                'bedrock:ConverseStream',
                'bedrock:Converse',
            ],
            resources: [
                `arn:aws:bedrock:*::foundation-model/${foundationModel}`,
                `arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0`,
                `arn:aws:bedrock:*:${this.account}:inference-profile/${foundationModel}`,
            ],
        }));
        // Add Memory permissions to Main Runtime
        runtimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:CreateEvent',
                'bedrock-agentcore:GetLastKTurns',
                'bedrock-agentcore:GetMemory',
                'bedrock-agentcore:ListEvents',
            ],
            resources: [
                `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/*`,
            ],
        }));
        // Add Gateway invocation permissions to Main Runtime
        runtimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:InvokeGateway',
                'bedrock-agentcore:GetGateway',
                'bedrock-agentcore:ListGatewayTargets',
            ],
            resources: [
                props.gatewayArn,
                `${props.gatewayArn}/*`, // For gateway targets
            ],
        }));
        // ========================================
        // Memory
        // ========================================
        const memory = new agentcore.Memory(this, 'FinOpsMemory', {
            memoryName: 'finops_memory',
            description: 'Memory for FinOps agent conversations',
            expirationDuration: cdk.Duration.days(30),
        });
        this.memoryId = memory.memoryId;
        // ========================================
        // Main Agent Runtime
        // ========================================
        const runtime = new agentcore.Runtime(this, 'FinOpsRuntime', {
            runtimeName: 'finops_runtime',
            description: 'FinOps Agent Runtime with Gateway integration',
            executionRole: runtimeRole,
            agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromEcrRepository(props.repository, 'latest'),
            networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
            environmentVariables: {
                MEMORY_ID: memory.memoryId,
                MODEL_ID: foundationModel,
                AWS_REGION: this.region,
                GATEWAY_ARN: props.gatewayArn,
                DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                FORCE_REBUILD: `${Date.now()}`,
            },
        });
        // Grant ECR pull permissions (fromEcrRepository doesn't auto-grant)
        props.repository.grantPull(runtimeRole);
        this.mainRuntimeArn = runtime.agentRuntimeArn;
        this.mainRuntimeRole = runtimeRole;
        this.mainRuntimeRoleArn = runtimeRole.roleArn;
        // ========================================
        // Outputs
        // ========================================
        new cdk.CfnOutput(this, 'AgentCoreArn', {
            value: this.mainRuntimeArn,
            description: 'AgentCore Runtime ARN',
            exportName: `${this.stackName}-AgentCoreArn`,
        });
        new cdk.CfnOutput(this, 'MemoryId', {
            value: this.memoryId,
            description: 'Memory ID',
            exportName: `${this.stackName}-MemoryId`,
        });
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: props.userPoolId,
            description: 'Cognito User Pool ID',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: props.userPoolClientId,
            description: 'Cognito User Pool Client ID',
        });
        new cdk.CfnOutput(this, 'IdentityPoolId', {
            value: props.identityPoolId,
            description: 'Cognito Identity Pool ID',
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(runtimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for ECR auth token, CloudWatch Logs, Bedrock model invocation, and AgentCore memory access',
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
exports.AgentRuntimeStack = AgentRuntimeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdlbnQtcnVudGltZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFnZW50LXJ1bnRpbWUtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLGdGQUFrRTtBQUNsRSx5REFBMkM7QUFHM0MscUNBQTBDO0FBWTFDLE1BQWEsaUJBQWtCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFNOUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE2QjtRQUNyRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLGVBQWUsR0FBRyw4Q0FBOEMsQ0FBQztRQUV2RSwyQ0FBMkM7UUFDM0MsWUFBWTtRQUNaLDJDQUEyQztRQUUzQyxvQkFBb0I7UUFDcEIsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDcEQsUUFBUSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsY0FBYztZQUN6QyxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsaUNBQWlDLENBQUM7U0FDdkUsQ0FBQyxDQUFDO1FBRUgsbUJBQW1CO1FBQ25CLFdBQVcsQ0FBQyxXQUFXLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzlDLEdBQUcsRUFBRSxnQkFBZ0I7WUFDckIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztZQUN4QixPQUFPLEVBQUUsQ0FBQywyQkFBMkIsQ0FBQztZQUN0QyxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUFDLENBQUM7UUFFSixrQkFBa0I7UUFDbEIsV0FBVyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDOUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztZQUN4QixPQUFPLEVBQUUsQ0FBQyx3QkFBd0IsQ0FBQztZQUNuQyxTQUFTLEVBQUUsQ0FBQyxnQkFBZ0IsSUFBSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsT0FBTyxjQUFjLENBQUM7U0FDdkUsQ0FBQyxDQUFDLENBQUM7UUFDSixXQUFXLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUM5QyxNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQ3hCLE9BQU8sRUFBRSxDQUFDLHlCQUF5QixFQUFFLHFCQUFxQixDQUFDO1lBQzNELFNBQVMsRUFBRSxDQUFDLGdCQUFnQixJQUFJLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLDhDQUE4QyxDQUFDO1NBQ3ZHLENBQUMsQ0FBQyxDQUFDO1FBQ0osV0FBVyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDOUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztZQUN4QixPQUFPLEVBQUUsQ0FBQyxzQkFBc0IsRUFBRSxtQkFBbUIsQ0FBQztZQUN0RCxTQUFTLEVBQUUsQ0FBQyxnQkFBZ0IsSUFBSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsT0FBTywyREFBMkQsQ0FBQztTQUNwSCxDQUFDLENBQUMsQ0FBQztRQUVKLGdEQUFnRDtRQUNoRCxXQUFXLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUM5QyxNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQ3hCLE9BQU8sRUFBRTtnQkFDUCxxQkFBcUI7Z0JBQ3JCLHVDQUF1QztnQkFDdkMsd0JBQXdCO2dCQUN4QixrQkFBa0I7YUFDbkI7WUFDRCxTQUFTLEVBQUU7Z0JBQ1QsdUNBQXVDLGVBQWUsRUFBRTtnQkFDeEQsK0VBQStFO2dCQUMvRSxxQkFBcUIsSUFBSSxDQUFDLE9BQU8sc0JBQXNCLGVBQWUsRUFBRTthQUN6RTtTQUNGLENBQUMsQ0FBQyxDQUFDO1FBRUoseUNBQXlDO1FBQ3pDLFdBQVcsQ0FBQyxXQUFXLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzlDLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDeEIsT0FBTyxFQUFFO2dCQUNQLCtCQUErQjtnQkFDL0IsaUNBQWlDO2dCQUNqQyw2QkFBNkI7Z0JBQzdCLDhCQUE4QjthQUMvQjtZQUNELFNBQVMsRUFBRTtnQkFDVCw2QkFBNkIsSUFBSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsT0FBTyxXQUFXO2FBQ3BFO1NBQ0YsQ0FBQyxDQUFDLENBQUM7UUFFSixxREFBcUQ7UUFDckQsV0FBVyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDOUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztZQUN4QixPQUFPLEVBQUU7Z0JBQ1AsaUNBQWlDO2dCQUNqQyw4QkFBOEI7Z0JBQzlCLHNDQUFzQzthQUN2QztZQUNELFNBQVMsRUFBRTtnQkFDVCxLQUFLLENBQUMsVUFBVTtnQkFDaEIsR0FBRyxLQUFLLENBQUMsVUFBVSxJQUFJLEVBQUUsc0JBQXNCO2FBQ2hEO1NBQ0YsQ0FBQyxDQUFDLENBQUM7UUFFSiwyQ0FBMkM7UUFDM0MsU0FBUztRQUNULDJDQUEyQztRQUUzQyxNQUFNLE1BQU0sR0FBRyxJQUFJLFNBQVMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUN4RCxVQUFVLEVBQUUsZUFBZTtZQUMzQixXQUFXLEVBQUUsdUNBQXVDO1lBQ3BELGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztTQUMxQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUM7UUFFaEMsMkNBQTJDO1FBQzNDLHFCQUFxQjtRQUNyQiwyQ0FBMkM7UUFFM0MsTUFBTSxPQUFPLEdBQUcsSUFBSSxTQUFTLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDM0QsV0FBVyxFQUFFLGdCQUFnQjtZQUM3QixXQUFXLEVBQUUsK0NBQStDO1lBQzVELGFBQWEsRUFBRSxXQUFXO1lBQzFCLG9CQUFvQixFQUFFLFNBQVMsQ0FBQyxvQkFBb0IsQ0FBQyxpQkFBaUIsQ0FDcEUsS0FBSyxDQUFDLFVBQVUsRUFDaEIsUUFBUSxDQUNUO1lBQ0Qsb0JBQW9CLEVBQUUsU0FBUyxDQUFDLDJCQUEyQixDQUFDLGtCQUFrQixFQUFFO1lBQ2hGLG9CQUFvQixFQUFFO2dCQUNwQixTQUFTLEVBQUUsTUFBTSxDQUFDLFFBQVE7Z0JBQzFCLFFBQVEsRUFBRSxlQUFlO2dCQUN6QixVQUFVLEVBQUUsSUFBSSxDQUFDLE1BQU07Z0JBQ3ZCLFdBQVcsRUFBRSxLQUFLLENBQUMsVUFBVTtnQkFDN0Isb0JBQW9CLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7Z0JBQzlDLGFBQWEsRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRTthQUMvQjtTQUNGLENBQUMsQ0FBQztRQUVILG9FQUFvRTtRQUNwRSxLQUFLLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUV4QyxJQUFJLENBQUMsY0FBYyxHQUFHLE9BQU8sQ0FBQyxlQUFlLENBQUM7UUFDOUMsSUFBSSxDQUFDLGVBQWUsR0FBRyxXQUFXLENBQUM7UUFDbkMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLFdBQVcsQ0FBQyxPQUFPLENBQUM7UUFFOUMsMkNBQTJDO1FBQzNDLFVBQVU7UUFDViwyQ0FBMkM7UUFFM0MsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLElBQUksQ0FBQyxjQUFjO1lBQzFCLFdBQVcsRUFBRSx1QkFBdUI7WUFDcEMsVUFBVSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsZUFBZTtTQUM3QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUNsQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFFBQVE7WUFDcEIsV0FBVyxFQUFFLFdBQVc7WUFDeEIsVUFBVSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsV0FBVztTQUN6QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNwQyxLQUFLLEVBQUUsS0FBSyxDQUFDLFVBQVU7WUFDdkIsV0FBVyxFQUFFLHNCQUFzQjtTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxLQUFLLENBQUMsZ0JBQWdCO1lBQzdCLFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsS0FBSyxDQUFDLGNBQWM7WUFDM0IsV0FBVyxFQUFFLDBCQUEwQjtTQUN4QyxDQUFDLENBQUM7UUFFSCwyQ0FBMkM7UUFDM0MsdUJBQXVCO1FBQ3ZCLDJDQUEyQztRQUUzQyx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLFdBQVcsRUFBRTtZQUNuRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsMEhBQTBIO2FBQ25JO1NBQ0YsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVULHlCQUFlLENBQUMsb0JBQW9CLENBQUMsSUFBSSxFQUFFO1lBQ3pDO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw0REFBNEQ7YUFDckU7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsc0ZBQXNGO2FBQy9GO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG9FQUFvRTthQUM3RTtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdMRCw4Q0E2TEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgYWdlbnRjb3JlIGZyb20gJ0Bhd3MtY2RrL2F3cy1iZWRyb2NrLWFnZW50Y29yZS1hbHBoYSc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFnZW50UnVudGltZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIHJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgdXNlclBvb2xBcm46IHN0cmluZztcbiAgZ2F0ZXdheUFybjogc3RyaW5nOyAvLyBHYXRld2F5IEFSTiBmcm9tIEFnZW50Q29yZUdhdGV3YXlTdGFja1xuICAvLyBGb3IgZnJvbnRlbmQgY29uZmlndXJhdGlvbiBvdXRwdXRzXG4gIHVzZXJQb29sSWQ6IHN0cmluZztcbiAgdXNlclBvb2xDbGllbnRJZDogc3RyaW5nO1xuICBpZGVudGl0eVBvb2xJZDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQWdlbnRSdW50aW1lU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgbWFpblJ1bnRpbWVBcm46IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG1lbW9yeUlkOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBtYWluUnVudGltZVJvbGU6IGlhbS5JUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IG1haW5SdW50aW1lUm9sZUFybjogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBBZ2VudFJ1bnRpbWVTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCBmb3VuZGF0aW9uTW9kZWwgPSAndXMuYW50aHJvcGljLmNsYXVkZS1zb25uZXQtNC01LTIwMjUwOTI5LXYxOjAnO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIElBTSBSb2xlc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIE1haW4gUnVudGltZSBSb2xlXG4gICAgY29uc3QgcnVudGltZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1J1bnRpbWVSb2xlJywge1xuICAgICAgcm9sZU5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1SdW50aW1lUm9sZWAsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgLy8gRUNSIHRva2VuIGFjY2Vzc1xuICAgIHJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIHNpZDogJ0VDUlRva2VuQWNjZXNzJyxcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbiddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIExvZ3NcbiAgICBydW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2xvZ3M6RGVzY3JpYmVMb2dHcm91cHMnXSxcbiAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDoqYF0sXG4gICAgfSkpO1xuICAgIHJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnbG9nczpEZXNjcmliZUxvZ1N0cmVhbXMnLCAnbG9nczpDcmVhdGVMb2dHcm91cCddLFxuICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvYmVkcm9jay1hZ2VudGNvcmUvcnVudGltZXMvKmBdLFxuICAgIH0pKTtcbiAgICBydW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJywgJ2xvZ3M6UHV0TG9nRXZlbnRzJ10sXG4gICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS9ydW50aW1lcy8qOmxvZy1zdHJlYW06KmBdLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBCZWRyb2NrIG1vZGVsIHBlcm1pc3Npb25zIHRvIE1haW4gUnVudGltZVxuICAgIHJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbScsXG4gICAgICAgICdiZWRyb2NrOkNvbnZlcnNlU3RyZWFtJyxcbiAgICAgICAgJ2JlZHJvY2s6Q29udmVyc2UnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvJHtmb3VuZGF0aW9uTW9kZWx9YCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoqOjpmb3VuZGF0aW9uLW1vZGVsL2FudGhyb3BpYy5jbGF1ZGUtc29ubmV0LTQtNS0yMDI1MDkyOS12MTowYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoqOiR7dGhpcy5hY2NvdW50fTppbmZlcmVuY2UtcHJvZmlsZS8ke2ZvdW5kYXRpb25Nb2RlbH1gLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgTWVtb3J5IHBlcm1pc3Npb25zIHRvIE1haW4gUnVudGltZVxuICAgIHJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkNyZWF0ZUV2ZW50JyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldExhc3RLVHVybnMnLFxuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6R2V0TWVtb3J5JyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkxpc3RFdmVudHMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpiZWRyb2NrLWFnZW50Y29yZToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bWVtb3J5LypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgR2F0ZXdheSBpbnZvY2F0aW9uIHBlcm1pc3Npb25zIHRvIE1haW4gUnVudGltZVxuICAgIHJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkludm9rZUdhdGV3YXknLFxuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6R2V0R2F0ZXdheScsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpMaXN0R2F0ZXdheVRhcmdldHMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBwcm9wcy5nYXRld2F5QXJuLFxuICAgICAgICBgJHtwcm9wcy5nYXRld2F5QXJufS8qYCwgLy8gRm9yIGdhdGV3YXkgdGFyZ2V0c1xuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTWVtb3J5XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgbWVtb3J5ID0gbmV3IGFnZW50Y29yZS5NZW1vcnkodGhpcywgJ0Zpbk9wc01lbW9yeScsIHtcbiAgICAgIG1lbW9yeU5hbWU6ICdmaW5vcHNfbWVtb3J5JyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTWVtb3J5IGZvciBGaW5PcHMgYWdlbnQgY29udmVyc2F0aW9ucycsXG4gICAgICBleHBpcmF0aW9uRHVyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICB9KTtcblxuICAgIHRoaXMubWVtb3J5SWQgPSBtZW1vcnkubWVtb3J5SWQ7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTWFpbiBBZ2VudCBSdW50aW1lXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgcnVudGltZSA9IG5ldyBhZ2VudGNvcmUuUnVudGltZSh0aGlzLCAnRmluT3BzUnVudGltZScsIHtcbiAgICAgIHJ1bnRpbWVOYW1lOiAnZmlub3BzX3J1bnRpbWUnLFxuICAgICAgZGVzY3JpcHRpb246ICdGaW5PcHMgQWdlbnQgUnVudGltZSB3aXRoIEdhdGV3YXkgaW50ZWdyYXRpb24nLFxuICAgICAgZXhlY3V0aW9uUm9sZTogcnVudGltZVJvbGUsXG4gICAgICBhZ2VudFJ1bnRpbWVBcnRpZmFjdDogYWdlbnRjb3JlLkFnZW50UnVudGltZUFydGlmYWN0LmZyb21FY3JSZXBvc2l0b3J5KFxuICAgICAgICBwcm9wcy5yZXBvc2l0b3J5LFxuICAgICAgICAnbGF0ZXN0J1xuICAgICAgKSxcbiAgICAgIG5ldHdvcmtDb25maWd1cmF0aW9uOiBhZ2VudGNvcmUuUnVudGltZU5ldHdvcmtDb25maWd1cmF0aW9uLnVzaW5nUHVibGljTmV0d29yaygpLFxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgTUVNT1JZX0lEOiBtZW1vcnkubWVtb3J5SWQsXG4gICAgICAgIE1PREVMX0lEOiBmb3VuZGF0aW9uTW9kZWwsXG4gICAgICAgIEFXU19SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgICBHQVRFV0FZX0FSTjogcHJvcHMuZ2F0ZXdheUFybixcbiAgICAgICAgREVQTE9ZTUVOVF9USU1FU1RBTVA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgRk9SQ0VfUkVCVUlMRDogYCR7RGF0ZS5ub3coKX1gLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IEVDUiBwdWxsIHBlcm1pc3Npb25zIChmcm9tRWNyUmVwb3NpdG9yeSBkb2Vzbid0IGF1dG8tZ3JhbnQpXG4gICAgcHJvcHMucmVwb3NpdG9yeS5ncmFudFB1bGwocnVudGltZVJvbGUpO1xuXG4gICAgdGhpcy5tYWluUnVudGltZUFybiA9IHJ1bnRpbWUuYWdlbnRSdW50aW1lQXJuO1xuICAgIHRoaXMubWFpblJ1bnRpbWVSb2xlID0gcnVudGltZVJvbGU7XG4gICAgdGhpcy5tYWluUnVudGltZVJvbGVBcm4gPSBydW50aW1lUm9sZS5yb2xlQXJuO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWdlbnRDb3JlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMubWFpblJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FnZW50Q29yZSBSdW50aW1lIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQWdlbnRDb3JlQXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNZW1vcnlJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm1lbW9yeUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdNZW1vcnkgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LU1lbW9yeUlkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywge1xuICAgICAgdmFsdWU6IHByb3BzLnVzZXJQb29sSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIElEJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbENsaWVudElkJywge1xuICAgICAgdmFsdWU6IHByb3BzLnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIENsaWVudCBJRCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSWRlbnRpdHlQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogcHJvcHMuaWRlbnRpdHlQb29sSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gSWRlbnRpdHkgUG9vbCBJRCcsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ0RLLU5hZyBTdXBwcmVzc2lvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMocnVudGltZVJvbGUsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1dpbGRjYXJkIHBlcm1pc3Npb25zIHJlcXVpcmVkIGZvciBFQ1IgYXV0aCB0b2tlbiwgQ2xvdWRXYXRjaCBMb2dzLCBCZWRyb2NrIG1vZGVsIGludm9jYXRpb24sIGFuZCBBZ2VudENvcmUgbWVtb3J5IGFjY2VzcycsXG4gICAgICB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFN0YWNrU3VwcHJlc3Npb25zKHRoaXMsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtTDEnLFxuICAgICAgICByZWFzb246ICdQeXRob24gMy4xNCBpcyB0aGUgbGF0ZXN0IExhbWJkYSBydW50aW1lIHZlcnNpb24gYXZhaWxhYmxlJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICByZWFzb246ICdBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgbWFuYWdlZCBwb2xpY3kgaXMgQVdTIGJlc3QgcHJhY3RpY2UgZm9yIExhbWJkYSBmdW5jdGlvbnMnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1dpbGRjYXJkIHBlcm1pc3Npb25zIHJlcXVpcmVkIGZvciBjdXN0b20gcmVzb3VyY2UgTGFtYmRhIGZ1bmN0aW9ucycsXG4gICAgICB9LFxuICAgIF0pO1xuICB9XG59XG4iXX0=