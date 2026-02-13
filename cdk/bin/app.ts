#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ImageStack } from '../lib/image-stack';
import { AuthStack } from '../lib/auth-stack';
import { MCPRuntimeStack } from '../lib/mcp-runtime-stack';
import { AgentCoreGatewayStack } from '../lib/gateway-stack';
import { AgentRuntimeStack } from '../lib/agent-runtime-stack';

const app = new cdk.App();

// Add CDK-Nag AWS Solutions checks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Get configuration from context or environment
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

const adminEmail = process.env.ADMIN_EMAIL || app.node.tryGetContext('adminEmail');

if (!adminEmail) {
  console.error('\n❌ ERROR: ADMIN_EMAIL environment variable is required.');
  console.error('Please set it before deploying:');
  console.error('  export ADMIN_EMAIL="your-email@example.com"');
  console.error('  cdk deploy\n');
  throw new Error('ADMIN_EMAIL environment variable is required. Set it before deploying.');
}

// ========================================
// Validated Deployment Sequence
// ========================================

// Stack 1: Image Stack - Builds Docker images for Agent Runtimes
const imageStack = new ImageStack(app, 'FinOpsImageStack', {
  env,
  description: 'FinOps Agent - Docker Image Build (ECR + CodeBuild)',
});

// Stack 2: Auth Stack - Cognito + M2M + OAuth Provider (Custom Resource)
const authStack = new AuthStack(app, 'FinOpsAuthStack', {
  env,
  description: 'FinOps Agent - Cognito Authentication + OAuth Provider',
  adminEmail: adminEmail,
});

// Stack 3: MCP Runtime Stack - Deploy 2 MCP Runtimes with JWT auth
const mcpRuntimeStack = new MCPRuntimeStack(app, 'FinOpsMCPRuntimeStack', {
  env,
  description: 'FinOps Agent - MCP Server Runtimes (Billing + Pricing) with JWT Authorization',
  billingMcpRepository: imageStack.billingMcpRepository,
  pricingMcpRepository: imageStack.pricingMcpRepository,
  userPoolId: authStack.userPoolId,
  m2mClientId: authStack.oauthClientId,
});
mcpRuntimeStack.addDependency(imageStack);
mcpRuntimeStack.addDependency(authStack);

// Stack 4: AgentCore Gateway Stack - Gateway + its own Cognito + OAuth provider + MCP targets
const agentCoreGatewayStack = new AgentCoreGatewayStack(app, 'FinOpsAgentCoreGatewayStack', {
  env,
  description: 'FinOps Agent - Gateway with MCP Server Targets',
  billingMcpRuntimeArn: mcpRuntimeStack.billingMcpRuntimeArn,
  pricingMcpRuntimeArn: mcpRuntimeStack.pricingMcpRuntimeArn,
  billingMcpRuntimeEndpoint: mcpRuntimeStack.billingMcpRuntimeEndpoint,
  pricingMcpRuntimeEndpoint: mcpRuntimeStack.pricingMcpRuntimeEndpoint,
  // AuthStack Cognito for outbound OAuth to runtimes
  authUserPoolId: authStack.userPoolId,
  authUserPoolArn: authStack.userPoolArn,
  authM2mClientId: authStack.oauthClientId,
});
agentCoreGatewayStack.addDependency(mcpRuntimeStack);
agentCoreGatewayStack.addDependency(authStack);

// Stack 5: Main Runtime Stack - Main agent runtime with Gateway ARN
const agentRuntimeStack = new AgentRuntimeStack(app, 'FinOpsAgentRuntimeStack', {
  env,
  description: 'FinOps Agent - Main Agent Runtime with Gateway Integration',
  repository: imageStack.repository,
  userPoolArn: authStack.userPoolArn,
  gatewayArn: agentCoreGatewayStack.gatewayArn,
  userPoolId: authStack.userPoolId,
  userPoolClientId: authStack.userPoolClientId,
  identityPoolId: authStack.identityPoolId,
});
agentRuntimeStack.addDependency(imageStack);
agentRuntimeStack.addDependency(authStack);
agentRuntimeStack.addDependency(agentCoreGatewayStack);

// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'FinOpsAgent');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
