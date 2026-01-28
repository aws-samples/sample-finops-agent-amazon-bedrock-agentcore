# FinOps Agent - AWS Cost Optimization AI Assistant (CDK)

Amazon Bedrock Agent Core Runtime integrated with AWS Cost Explorer and Pricing APIs for intelligent cost analysis and optimization.

> **Note:** The React frontend application will be provided separately as an AWS Amplify deployment package. This repository contains the complete backend infrastructure and agent runtime.

## Architecture

![Architecture Diagram](docs/images/architecture-diagram.png)

The solution uses a left-to-right flow with the following components:

```
User → AWS Amplify → Cognito → AgentCore Runtime (ECS) → Gateway → MCP Lambda Servers
                                                              ├─ Billing Lambda (11 Cost Tools)
                                                              └─ Pricing Lambda (9 Pricing Tools)
```

**Key Components:**
- **Agent Runtime**: Containerized Python agent using Strands SDK with Gateway integration
- **Gateway**: Routes tool requests to appropriate MCP Lambda servers
- **MCP Lambdas**: Billing and Pricing tools for cost analysis
- **Cognito**: User authentication and authorization
- **Memory**: Conversation history storage

## What's Included

### Infrastructure (CDK - 3 Stacks)
1. **Image Stack**: ECR repository + ARM64 CodeBuild for Docker image
2. **Agent Stack**: Agent Core Runtime, Gateway, MCP Lambda servers, Memory
3. **Auth Stack**: Cognito User Pool, Identity Pool, IAM roles

### Runtime Code
- `agentcore/agent_runtime.py`: Python agent with Gateway integration
- `agentcore/streamable_http_sigv4.py`: SigV4 authentication for Gateway
- `agentcore/Dockerfile`: Container image for Agent Runtime
- `agentcore/requirements.txt`: Python dependencies

### MCP Servers
- `lambda/billing_mcp_server.py`: Cost Explorer, Budgets, Compute Optimizer tools
- `lambda/pricing_mcp_server.py`: AWS Pricing API tools
- `lambda/requirements.txt`: Lambda dependencies

### Scripts
- `deploy.sh`: Deploy all 3 CDK stacks
- `cleanup.sh`: Destroy all resources

## Prerequisites

### 1. AWS CLI Configured

The deployment script uses your AWS CLI credentials to determine the target account and region.

**Install AWS CLI:**
```bash
# macOS
brew install awscli

# Linux
pip install awscli

# Windows - Download from: https://aws.amazon.com/cli/
```

**Configure Credentials:**
```bash
aws configure
```

You'll be prompted for:
- **AWS Access Key ID**: Your IAM user access key
- **AWS Secret Access Key**: Your IAM user secret key  
- **Default region**: e.g., `us-east-1`
- **Output format**: `json` (recommended)

**Verify Configuration:**
```bash
aws sts get-caller-identity
```

This should display your AWS account ID and user/role ARN.

**Region Override (Optional):**
```bash
# Deploy to a different region
export AWS_REGION=us-west-2
./scripts/deploy.sh
```

### 2. Node.js and npm

Required for CDK:
- **Node.js**: v18+ ([Download](https://nodejs.org/))
- **npm**: Comes with Node.js

### 3. Python

Required for Lambda functions:
- **Python**: 3.13+ ([Download](https://www.python.org/))

### 4. Admin Email

You'll be prompted for an email address during deployment. This creates the Cognito admin user and sends a temporary password.

**Note:** Docker is NOT required locally - CodeBuild handles the ARM64 image build in AWS.

## Quick Start

### 1. Deploy

```bash
# Clone or download the repository
cd sample-finops-agent-amazon-agentcore

# Option 1: Run from repository root
./scripts/deploy-interactive.sh

# Option 2: Run from scripts directory
cd scripts
./deploy-interactive.sh

```

**Note:** Scripts can be run from either the repository root or the scripts directory.

The script will:
- Prompt for admin email (if not set)
- Install CDK dependencies
- Build TypeScript
- Bootstrap CDK (if needed)
- Deploy all 3 stacks in order
- Display Runtime ARN and other outputs

### 2. Get Credentials

After deployment:
1. Check your email for temporary password
2. Username: `admin`
3. You'll be prompted to change password on first login

### 3. Connect Frontend

Use the **Runtime ARN** from deployment outputs:

```typescript
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";

const client = new BedrockAgentCoreClient({ region: "us-east-1" });

const response = await client.send(new InvokeAgentRuntimeCommand({
  runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/...",
  prompt: "What are my AWS costs this month?"
}));
```

### 4. Monitor Logs

```bash
# Agent Runtime logs
aws logs tail /aws/bedrock-agentcore/runtime/finops-runtime --follow

# Billing Lambda logs
aws logs tail /aws/lambda/FinOpsAgentStack-billing-mcp --follow

# Pricing Lambda logs
aws logs tail /aws/lambda/FinOpsAgentStack-pricing-mcp --follow
```

## Cleanup

```bash
cd finops-agent-cdk
./cleanup.sh
```

## Project Structure

```
finops-agent-cdk/
├── cdk/                          # CDK infrastructure code
│   ├── bin/
│   │   └── app.ts               # CDK app entry point (3 stacks)
│   ├── lib/
│   │   ├── image-stack.ts       # Stack 1: Docker image build
│   │   ├── agent-stack.ts       # Stack 2: Agent Core resources
│   │   └── auth-stack.ts        # Stack 3: Cognito authentication
│   ├── package.json
│   ├── tsconfig.json
│   └── cdk.json
├── agentcore/                   # Agent runtime code
│   ├── agent_runtime.py        # Agent runtime code
│   ├── streamable_http_sigv4.py # SigV4 auth helper
│   ├── Dockerfile              # Container image
│   └── requirements.txt        # Python dependencies
├── lambda/                      # MCP Lambda servers
│   ├── billing_mcp_server.py   # Billing tools
│   ├── pricing_mcp_server.py   # Pricing tools
│   └── requirements.txt        # Lambda dependencies
├── docs/                        # Documentation
│   └── troubleshooting/        # Development history & troubleshooting
├── deploy.sh                   # Deployment script
├── cleanup.sh                  # Cleanup script
├── README.md                   # This file (Quick start)
├── BLOG-COMPLETE-GUIDE.md      # Comprehensive guide for blog/documentation
└── FINAL-TOOL-ARCHITECTURE.md  # Tool architecture reference
```

## Documentation

### Quick Reference
- **README.md** (this file) - Quick start and basic usage
- **BLOG-COMPLETE-GUIDE.md** - Comprehensive guide with architecture, challenges, solutions, and best practices
- **FINAL-TOOL-ARCHITECTURE.md** - Detailed tool architecture and design decisions

### Development History
- **docs/troubleshooting/** - Working documents, troubleshooting guides, and development history

## Available Tools

The agent has access to **20 cost optimization tools** via Gateway:

### Billing Tools (11 tools)
1. **get_cost_and_usage**: Historical cost and usage data with flexible grouping
2. **get_cost_by_service**: Service-level cost breakdown
3. **get_cost_by_usage_type**: Usage type breakdown
4. **get_cost_forecast**: Future cost predictions
5. **get_cost_anomalies**: Cost anomaly detection
6. **get_budgets**: List all budgets
7. **get_budget_details**: Detailed budget information
8. **get_free_tier_usage**: Free Tier usage tracking
9. **get_rightsizing_recommendations**: EC2 rightsizing suggestions
10. **get_savings_plans_recommendations**: Savings Plans opportunities
11. **get_compute_optimizer_recommendations**: Multi-resource optimization (EC2, EBS, Lambda)

### Pricing Tools (9 tools)
1. **get_service_codes**: List all AWS services
2. **get_service_attributes**: Service pricing attributes
3. **get_attribute_values**: Attribute value options
4. **get_service_pricing**: Generic service pricing
5. **get_ec2_pricing**: EC2 instance pricing
6. **get_rds_pricing**: RDS instance pricing
7. **get_lambda_pricing**: Lambda pricing
8. **compare_instance_pricing**: Compare multiple EC2 instance types

See **FINAL-TOOL-ARCHITECTURE.md** for detailed tool descriptions and usage examples.

## Configuration

### Environment Variables (Runtime)

Set in `cdk/lib/agent-stack.ts`:
- `GATEWAY_ARN`: Agent Core Gateway ARN (auto-configured)
- `MEMORY_ID`: Agent Core Memory ID (auto-configured)
- `MODEL_ID`: Foundation model (default: `us.amazon.nova-pro-v1:0`)
- `AWS_REGION`: AWS region (auto-configured)

### Cognito Configuration

Set before deployment:
- `ADMIN_EMAIL`: Admin user email address

## Troubleshooting

### Deployment fails with "TriggerBuild failed"
- Check CodeBuild logs in CloudWatch
- Verify ECR permissions

### "Gateway ARN not configured" error
- Check Runtime environment variables in CDK
- Verify Gateway was created successfully

### Tools not working
- Check Gateway target configuration
- Verify MCP Lambda has correct permissions
- Review Gateway invocation logs

### Authentication issues
- Verify Cognito User Pool configuration
- Check Identity Pool role mappings
- Ensure Runtime ARN is in authenticated role policy

## Key Differences from CloudFormation Version

1. **All CDK**: No CloudFormation templates, pure CDK TypeScript
2. **Container-Based Runtime**: Uses ECS containers instead of S3 zip files
3. **Gateway Integration**: Runtime uses Gateway for tool access (not direct Lambda)
4. **Environment Variables**: Gateway ARN and Memory ID passed via env vars
5. **Latest API**: Uses @aws-cdk/aws-bedrock-agentcore-alpha v2.235.1-alpha.0
6. **Simplified**: Cleaner code structure, better error handling
7. **MCP Format**: Lambda returns proper MCP format: `{content: [{type: "text", text: "..."}]}`

## Architecture Flow

1. **User authenticates** via Cognito
2. **Frontend invokes** Agent Runtime with prompt
3. **Runtime processes** request using Strands Agent
4. **Agent calls tools** through MCP Client with SigV4 auth
5. **Gateway routes** to appropriate Lambda (billing or pricing)
6. **Lambda executes** AWS API calls
7. **Lambda returns** results in MCP format
8. **Gateway delivers** to Runtime
9. **Runtime formats** response
10. **Frontend receives** answer

## Support

For issues or questions:
1. Check CloudWatch logs for runtime errors
2. Review DEPLOYMENT-GUIDE.md for detailed instructions
3. Verify all prerequisites are met
4. Check IAM permissions for access errors

## Version Information

- **Version**: 1.0.0
- **Architecture**: Gateway-based with ECS Runtime
- **Infrastructure**: AWS CDK (TypeScript)
- **Runtime**: Python 3.13
- **CDK Version**: 2.235.0
- **Agent Core Alpha**: 2.235.1-alpha.0
- **Model**: Amazon Nova Pro (us.amazon.nova-pro-v1:0)

## Contributors

- Ravi Kumar (Sr. Technical Account Manager)
- Salman Ahmed (Sr. Technical Account Manager)
- Sergio Barraza (Sr. Technical Account Manager)
- Ankush Goyal (Sr. Technical Account Manager)