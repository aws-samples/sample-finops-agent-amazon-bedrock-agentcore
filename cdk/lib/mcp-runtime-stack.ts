import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface MCPRuntimeStackProps extends cdk.StackProps {
  billingMcpRepository: ecr.IRepository;
  pricingMcpRepository: ecr.IRepository;
  // From AuthStack - for JWT authorization on runtimes
  userPoolId: string;
  m2mClientId: string;
}

export class MCPRuntimeStack extends cdk.Stack {
  public readonly billingMcpRuntimeArn: string;
  public readonly pricingMcpRuntimeArn: string;
  public readonly billingMcpRuntimeEndpoint: string;
  public readonly pricingMcpRuntimeEndpoint: string;

  constructor(scope: Construct, id: string, props: MCPRuntimeStackProps) {
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
    const commonRuntimePermissions: iam.PolicyStatement[] = [
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

    NagSuppressions.addResourceSuppressions(billingMcpRuntimeRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for Cost Explorer APIs (account-level services), ECR auth token, CloudWatch, X-Ray',
      },
    ], true);

    NagSuppressions.addResourceSuppressions(pricingMcpRuntimeRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for AWS Pricing API (global service), ECR auth token, CloudWatch, X-Ray',
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
