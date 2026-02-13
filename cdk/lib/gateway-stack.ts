import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface AgentCoreGatewayStackProps extends cdk.StackProps {
  // MCP Runtime endpoints from MCPRuntimeStack
  billingMcpRuntimeArn: string;
  billingMcpRuntimeEndpoint: string;
  pricingMcpRuntimeArn: string;
  pricingMcpRuntimeEndpoint: string;
  // AuthStack Cognito - used for OAuth provider (outbound auth to runtimes)
  authUserPoolId: string;
  authUserPoolArn: string;
  authM2mClientId: string;
}

export class AgentCoreGatewayStack extends cdk.Stack {
  public readonly gatewayArn: string;
  public readonly gatewayUrl: string;

  constructor(scope: Construct, id: string, props: AgentCoreGatewayStackProps) {
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
      runtime: lambda.Runtime.PYTHON_3_12,
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
    req = urllib.request.Request(
        event['ResponseURL'],
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

    NagSuppressions.addResourceSuppressions(gatewayRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore Identity token exchange and OAuth provider management.' },
    ], true);

    NagSuppressions.addResourceSuppressions(oauthProviderFn, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard required for AgentCore Identity token vault creation and bedrock-agentcore-identity secrets namespace.' },
    ], true);

    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore Identity token exchange, OAuth credential provider management.', appliesTo: ['Resource::*'] },
      { id: 'AwsSolutions-L1', reason: 'Lambda runtime version managed by CDK.' },
    ]);
  }
}
