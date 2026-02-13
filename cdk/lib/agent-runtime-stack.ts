import * as cdk from 'aws-cdk-lib';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface AgentRuntimeStackProps extends cdk.StackProps {
  repository: ecr.IRepository;
  userPoolArn: string;
  gatewayArn: string; // Gateway ARN from AgentCoreGatewayStack
  // For frontend configuration outputs
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
}

export class AgentRuntimeStack extends cdk.Stack {
  public readonly mainRuntimeArn: string;
  public readonly memoryId: string;
  public readonly mainRuntimeRole: iam.IRole;
  public readonly mainRuntimeRoleArn: string;

  constructor(scope: Construct, id: string, props: AgentRuntimeStackProps) {
    super(scope, id, props);

    const foundationModel = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0';

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
        `arn:aws:bedrock:*::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0`,
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
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromEcrRepository(
        props.repository,
        'latest'
      ),
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        // MEMORY_ID temporarily disabled to debug streaming error
        // MEMORY_ID: memory.memoryId,
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

    new cdk.CfnOutput(this, 'MainRuntimeArn', {
      value: this.mainRuntimeArn,
      description: 'Main Agent Runtime ARN',
      exportName: `${this.stackName}-MainRuntimeArn`,
    });

    new cdk.CfnOutput(this, 'MemoryId', {
      value: this.memoryId,
      description: 'Memory ID',
      exportName: `${this.stackName}-MemoryId`,
    });

    // ========================================
    // Frontend Configuration (use these to configure your frontend app)
    // ========================================

    new cdk.CfnOutput(this, 'FrontendUserPoolId', {
      value: props.userPoolId,
      description: '🔧 Frontend Config: Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'FrontendUserPoolClientId', {
      value: props.userPoolClientId,
      description: '🔧 Frontend Config: Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'FrontendIdentityPoolId', {
      value: props.identityPoolId,
      description: '🔧 Frontend Config: Cognito Identity Pool ID',
    });

    new cdk.CfnOutput(this, 'FrontendRuntimeArn', {
      value: this.mainRuntimeArn,
      description: '🔧 Frontend Config: Main Agent Runtime ARN',
    });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================

    NagSuppressions.addResourceSuppressions(runtimeRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for ECR auth token, CloudWatch Logs, Bedrock model invocation, and AgentCore memory access',
      },
    ], true);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-L1',
        reason: 'Python 3.13 is the latest Lambda runtime version available',
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
