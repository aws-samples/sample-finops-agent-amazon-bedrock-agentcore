import * as cdk from 'aws-cdk-lib';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import * as path from 'path';
import { NagSuppressions } from 'cdk-nag';

export interface AgentStackProps extends cdk.StackProps {
  repository: ecr.IRepository;
}

export class AgentStack extends cdk.Stack {
  public readonly runtimeArn: string;
  public readonly gatewayArn: string;
  public readonly memoryId: string;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    // Foundation model for the agent
    const foundationModel = 'us.amazon.nova-pro-v1:0';

    // ========================================
    // IAM Roles
    // ========================================

    // Runtime Role
    const runtimeRole = new iam.Role(this, 'RuntimeRole', {
      roleName: `${this.stackName}-RuntimeRole`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('BedrockAgentCoreFullAccess'),
      ],
    });

    // Add Bedrock model permissions
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
        `arn:aws:bedrock:*:${this.account}:inference-profile/${foundationModel}`,
      ],
    }));

    // Phase 1: Add Memory permissions for AgentCore Memory
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateEvent',
        'bedrock-agentcore:GetLastKTurns',
        'bedrock-agentcore:GetMemory',
      ],
      resources: [
        `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/*`,
      ],
    }));

    // Gateway Role
    const gatewayRole = new iam.Role(this, 'GatewayRole', {
      roleName: `${this.stackName}-GatewayRole`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    // Billing Lambda Role
    const billingLambdaRole = new iam.Role(this, 'BillingLambdaRole', {
      roleName: `${this.stackName}-BillingLambdaRole`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add Cost Explorer and billing permissions
    billingLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ce:*',
        'budgets:*',
        'compute-optimizer:*',
        'freetier:*',
        'cost-optimization-hub:*',
        'pricing:*',
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

    // Pricing Lambda Role
    const pricingLambdaRole = new iam.Role(this, 'PricingLambdaRole', {
      roleName: `${this.stackName}-PricingLambdaRole`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add Pricing API permissions
    pricingLambdaRole.addToPolicy(new iam.PolicyStatement({
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
    // MCP Lambda Functions
    // ========================================

    // Billing MCP Lambda
    const billingLambda = new lambda.Function(this, 'BillingMcpLambda', {
      functionName: `${this.stackName}-billing-mcp`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'billing_mcp_server.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda')),
      role: billingLambdaRole,
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
    });

    // Pricing MCP Lambda
    const pricingLambda = new lambda.Function(this, 'PricingMcpLambda', {
      functionName: `${this.stackName}-pricing-mcp`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'pricing_mcp_server.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda')),
      role: pricingLambdaRole,
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
    });

    // Grant Gateway permission to invoke Lambdas
    billingLambda.grantInvoke(gatewayRole);
    pricingLambda.grantInvoke(gatewayRole);

    // ========================================
    // Gateway with MCP Targets
    // ========================================

    // Agent Core Gateway with IAM authentication
    const gateway = new agentcore.Gateway(this, 'FinOpsGateway', {
      gatewayName: 'finops-gateway',
      description: 'Gateway for FinOps billing and pricing MCP tools',
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
    });

    this.gatewayArn = gateway.gatewayArn;

    // Add Billing Lambda Target
    const billingTarget = gateway.addLambdaTarget('BillingTarget', {
      gatewayTargetName: 'billing',
      lambdaFunction: billingLambda,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'get_cost_and_usage',
          description: 'Get ACTUAL AWS costs and usage data (your bill/spending) for a date range. Use this for historical spending analysis, not for pricing rates. Can group by REGION, LINKED_ACCOUNT, INSTANCE_TYPE, PLATFORM, TENANCY, and other AWS dimensions. For service or usage type breakdowns, use dedicated tools.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              start_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'Start date (YYYY-MM-DD)' },
              end_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'End date (YYYY-MM-DD)' },
              granularity: { type: agentcore.SchemaDefinitionType.STRING, description: 'Time granularity (DAILY or MONTHLY)'},
              group_by_dimension: { type: agentcore.SchemaDefinitionType.STRING, description: 'Optional dimension to group costs by. Common values: "REGION" for regional breakdown, "LINKED_ACCOUNT" for account breakdown, "INSTANCE_TYPE" for instance type breakdown, "PLATFORM" for platform breakdown, "TENANCY" for tenancy breakdown. Do NOT use "SERVICE" or "USAGE_TYPE" - use dedicated tools for those.' },
            },
            required: ['start_date', 'end_date'],
          },
        },
        {
          name: 'get_cost_by_service',
          description: 'Get ACTUAL AWS costs (your spending) grouped by service - shows breakdown of what you spent per AWS service. Use this for historical spending analysis, not for pricing rates.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              start_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'Start date (YYYY-MM-DD)' },
              end_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'End date (YYYY-MM-DD)' },
              granularity: { type: agentcore.SchemaDefinitionType.STRING, description: 'Time granularity (DAILY or MONTHLY)'},
              group_by_service: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to group by service'},
            },
            required: ['start_date', 'end_date', 'group_by_service'],
          },
        },
        {
          name: 'get_cost_by_usage_type',
          description: 'Get ACTUAL AWS costs (your spending) grouped by usage type - shows breakdown of what you spent per usage type (e.g., BoxUsage, DataTransfer, etc.). Use this for historical spending analysis, not for pricing rates.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              start_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'Start date (YYYY-MM-DD)' },
              end_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'End date (YYYY-MM-DD)' },
              granularity: { type: agentcore.SchemaDefinitionType.STRING, description: 'Time granularity (DAILY or MONTHLY)'},
              group_by_usage_type: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to group by usage type'},
            },
            required: ['start_date', 'end_date', 'group_by_usage_type'],
          },
        },
        {
          name: 'get_budgets',
          description: 'Get all AWS budgets and their status',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              list_budgets: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to list budgets'},
            },
            required: ['list_budgets'],
          },
        },
        {
          name: 'get_budget_details',
          description: 'Get detailed information about a specific budget',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              budget_name: { type: agentcore.SchemaDefinitionType.STRING, description: 'Name of the budget' },
            },
            required: ['budget_name'],
          },
        },
        {
          name: 'get_compute_optimizer_recommendations',
          description: 'Get AWS Compute Optimizer recommendations for cost optimization',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              resource_type: { 
                type: agentcore.SchemaDefinitionType.STRING, 
                description: 'Type of resource (EC2Instance, EBSVolume, or Lambda)',
              },
            },
            required: ['resource_type'],
          },
        },
        {
          name: 'get_free_tier_usage',
          description: 'Get AWS Free Tier usage and limits',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              check_free_tier: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to check free tier'},
            },
            required: ['check_free_tier'],
          },
        },
        {
          name: 'get_cost_anomalies',
          description: 'Get detected cost anomalies',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              start_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'Start date (YYYY-MM-DD)' },
              end_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'End date (YYYY-MM-DD)' },
              detect_anomalies: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to detect anomalies'},
            },
            required: ['start_date', 'end_date', 'detect_anomalies'],
          },
        },
        {
          name: 'get_cost_forecast',
          description: 'Get cost forecast for a future period',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              start_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'Start date (YYYY-MM-DD)' },
              end_date: { type: agentcore.SchemaDefinitionType.STRING, description: 'End date (YYYY-MM-DD)' },
              metric: { type: agentcore.SchemaDefinitionType.STRING, description: 'Metric type (UNBLENDED_COST, BLENDED_COST)'},
            },
            required: ['start_date', 'end_date', 'metric'],
          },
        },
        {
          name: 'get_rightsizing_recommendations',
          description: 'Get EC2 rightsizing recommendations from Cost Explorer with potential savings',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              get_rightsizing: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to get rightsizing recommendations'},
            },
            required: ['get_rightsizing'],
          },
        },
        {
          name: 'get_savings_plans_recommendations',
          description: 'Get Savings Plans purchase recommendations with estimated savings',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              get_savings_plans: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to get savings plans recommendations'},
            },
            required: ['get_savings_plans'],
          },
        },
      ]),
      credentialProviderConfigurations: [
        agentcore.GatewayCredentialProvider.fromIamRole(),
      ],
    });

    // Add Pricing Lambda Target
    const pricingTarget = gateway.addLambdaTarget('PricingTarget', {
      gatewayTargetName: 'pricing',
      lambdaFunction: pricingLambda,
      toolSchema: agentcore.ToolSchema.fromInline([
        {
          name: 'get_service_codes',
          description: 'Get list of AWS service codes for pricing',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {},
          },
        },
        {
          name: 'get_service_attributes',
          description: 'Get available pricing attributes for a specific AWS service',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              service_code: { type: agentcore.SchemaDefinitionType.STRING, description: 'AWS service code (e.g., AmazonEC2)' },
              get_attributes: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to get attributes'},
            },
            required: ['service_code', 'get_attributes'],
          },
        },
        {
          name: 'get_attribute_values',
          description: 'Get possible values for a pricing attribute',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              service_code: { type: agentcore.SchemaDefinitionType.STRING, description: 'AWS service code' },
              attribute_name: { type: agentcore.SchemaDefinitionType.STRING, description: 'Name of the pricing attribute' },
            },
            required: ['service_code', 'attribute_name'],
          },
        },
        {
          name: 'get_service_pricing',
          description: 'Get pricing for a specific AWS service',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              service_code: { type: agentcore.SchemaDefinitionType.STRING, description: 'AWS service code' },
              region: { type: agentcore.SchemaDefinitionType.STRING, description: 'AWS region' },
              filters: { type: agentcore.SchemaDefinitionType.OBJECT, description: 'Optional filters' },
            },
            required: ['service_code'],
          },
        },
        {
          name: 'get_ec2_pricing',
          description: 'Get EC2 instance PRICING RATES (not your actual spending). Use this to find out how much AWS charges per hour for an instance type, not to see what you spent.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              instance_type: { type: agentcore.SchemaDefinitionType.STRING, description: 'EC2 instance type' },
              region: { type: agentcore.SchemaDefinitionType.STRING, description: 'AWS region' },
              operating_system: { type: agentcore.SchemaDefinitionType.STRING, description: 'Operating system' },
            },
            required: ['instance_type'],
          },
        },
        {
          name: 'get_rds_pricing',
          description: 'Get RDS instance PRICING RATES (not your actual spending). Use this to find out how much AWS charges per hour for an RDS instance, not to see what you spent.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              instance_type: { type: agentcore.SchemaDefinitionType.STRING, description: 'RDS instance type' },
              engine: { type: agentcore.SchemaDefinitionType.STRING, description: 'Database engine' },
              region: { type: agentcore.SchemaDefinitionType.STRING, description: 'AWS region' },
            },
            required: ['instance_type', 'engine'],
          },
        },
        {
          name: 'get_lambda_pricing',
          description: 'Get AWS Lambda PRICING RATES (not your actual spending). Use this to find out how much AWS charges for Lambda execution, not to see what you spent.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              region: { type: agentcore.SchemaDefinitionType.STRING, description: 'AWS region'},
              get_lambda_pricing: { type: agentcore.SchemaDefinitionType.BOOLEAN, description: 'Always set to true to get Lambda pricing'},
            },
            required: ['get_lambda_pricing'],
          },
        },
        {
          name: 'compare_instance_pricing',
          description: 'Compare PRICING RATES across multiple EC2 instance types (not your actual spending). Use this to compare how much AWS charges per hour for different instances.',
          inputSchema: {
            type: agentcore.SchemaDefinitionType.OBJECT,
            properties: {
              instance_types: { 
                type: agentcore.SchemaDefinitionType.ARRAY, 
                description: 'List of instance types to compare',
                items: { type: agentcore.SchemaDefinitionType.STRING }
              },
              region: { type: agentcore.SchemaDefinitionType.STRING, description: 'AWS region' },
            },
            required: ['instance_types'],
          },
        },
      ]),
      credentialProviderConfigurations: [
        agentcore.GatewayCredentialProvider.fromIamRole(),
      ],
    });

    // Ensure Gateway service role has permissions before creating targets
    const gatewayServiceRole = gateway.node.findChild('ServiceRole') as iam.Role;
    const gatewayServiceRolePolicy = gatewayServiceRole.node.findChild('DefaultPolicy') as iam.Policy;
    billingTarget.node.addDependency(gatewayServiceRolePolicy);
    pricingTarget.node.addDependency(gatewayServiceRolePolicy);

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
    // Agent Runtime
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
        GATEWAY_ARN: gateway.gatewayArn,
        MEMORY_ID: memory.memoryId,
        MODEL_ID: foundationModel,
        AWS_REGION: this.region,
        BILLING_LAMBDA_NAME: billingLambda.functionName,
        PRICING_LAMBDA_NAME: pricingLambda.functionName,
        DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
      },
    });

    this.runtimeArn = runtime.agentRuntimeArn;

    // Grant Runtime permission to use Gateway
    gateway.grantInvoke(runtimeRole);

    // Grant Runtime permission to invoke Lambda functions directly
    billingLambda.grantInvoke(runtimeRole);
    pricingLambda.grantInvoke(runtimeRole);

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'RuntimeArn', {
      value: this.runtimeArn,
      description: 'Agent Runtime ARN (use this in your frontend)',
      exportName: `${this.stackName}-RuntimeArn`,
    });

    new cdk.CfnOutput(this, 'GatewayArn', {
      value: this.gatewayArn,
      description: 'Gateway ARN',
      exportName: `${this.stackName}-GatewayArn`,
    });

    new cdk.CfnOutput(this, 'MemoryId', {
      value: this.memoryId,
      description: 'Memory ID',
      exportName: `${this.stackName}-MemoryId`,
    });

    new cdk.CfnOutput(this, 'BillingLambdaArn', {
      value: billingLambda.functionArn,
      description: 'Billing MCP Lambda ARN',
    });

    new cdk.CfnOutput(this, 'PricingLambdaArn', {
      value: pricingLambda.functionArn,
      description: 'Pricing MCP Lambda ARN',
    });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================

    // Runtime Role suppressions
    NagSuppressions.addResourceSuppressions(runtimeRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'BedrockAgentCoreFullAccess managed policy required for AgentCore runtime service role',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for: (1) Bedrock model invocation across all regions, (2) AgentCore memory access for all conversation sessions, (3) CloudWatch Logs for runtime logging, (4) Lambda function version invocation',
      },
    ], true);

    // Lambda Role suppressions
    NagSuppressions.addResourceSuppressions(billingLambdaRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required because Cost Explorer, Budgets, Compute Optimizer, and Free Tier APIs do not support resource-level permissions - these are account-level services',
      },
    ], true);

    NagSuppressions.addResourceSuppressions(pricingLambdaRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required because AWS Pricing API does not support resource-level permissions - it is a global service',
      },
    ], true);

    // Lambda function suppressions
    NagSuppressions.addResourceSuppressions(billingLambda, [
      {
        id: 'AwsSolutions-L1',
        reason: 'Python 3.13 is the latest Lambda runtime version available',
      },
    ], true);

    NagSuppressions.addResourceSuppressions(pricingLambda, [
      {
        id: 'AwsSolutions-L1',
        reason: 'Python 3.13 is the latest Lambda runtime version available',
      },
    ], true);

    // Gateway Role suppressions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      '/FinOpsAgentStack/FinOpsGateway/ServiceRole/DefaultPolicy/Resource',
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Wildcard permissions required for Gateway to invoke Lambda function versions (Lambda automatically creates version ARNs with :$LATEST and numbered versions)',
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      '/FinOpsAgentStack/GatewayRole/DefaultPolicy/Resource',
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Wildcard permissions required for Gateway to invoke Lambda function versions (Lambda automatically creates version ARNs with :$LATEST and numbered versions)',
        },
      ]
    );
  }
}
