#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ImageStack } from '../lib/image-stack';
import { AgentStack } from '../lib/agent-stack';
import { AuthStack } from '../lib/auth-stack';

const app = new cdk.App();

// Add CDK-Nag AWS Solutions checks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Get configuration from context or environment
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

const adminEmail = process.env.ADMIN_EMAIL || app.node.tryGetContext('adminEmail');

// Stack 1: Image Stack - Builds Docker image for Agent Runtime
const imageStack = new ImageStack(app, 'FinOpsImageStack', {
  env,
  description: 'FinOps Agent - Docker Image Build (ECR + CodeBuild)',
});

// Stack 2: Agent Stack - Agent Core Runtime, Gateway, MCP Lambdas
const agentStack = new AgentStack(app, 'FinOpsAgentStack', {
  env,
  description: 'FinOps Agent - Agent Core Runtime, Gateway, and MCP Servers',
  repository: imageStack.repository,
});
agentStack.addDependency(imageStack);

// Stack 3: Auth Stack - Cognito for user authentication (only if adminEmail is provided)
if (adminEmail) {
  const authStack = new AuthStack(app, 'FinOpsAuthStack', {
    env,
    description: 'FinOps Agent - Cognito Authentication',
    runtimeArn: agentStack.runtimeArn,
    adminEmail: adminEmail,
  });
  authStack.addDependency(agentStack);
} else {
  console.warn('Warning: ADMIN_EMAIL not set. Auth stack will not be created. Set ADMIN_EMAIL to deploy authentication.');
}

// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'FinOpsAgent');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
