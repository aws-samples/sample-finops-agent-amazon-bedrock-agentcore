# Guidance for Building a FinOps Agent Using Amazon Bedrock AgentCore on AWS

## Table of Contents

1. [Overview](#overview)
    - [Cost](#cost)
2. [Prerequisites](#prerequisites)
    - [Operating System](#operating-system)
    - [Third-party tools](#third-party-tools)
    - [AWS account requirements](#aws-account-requirements)
    - [AWS CDK bootstrap](#aws-cdk-bootstrap)
    - [Supported Regions](#supported-regions)
3. [Automated Deployment](#automated-deployment)
4. [Manual Deployment](#manual-deployment)
5. [Deployment Validation](#deployment-validation)
6. [Running the Guidance](#running-the-guidance)
7. [Next Steps](#next-steps)
8. [Cleanup](#cleanup)
9. [FAQ, Known Issues, Additional Considerations, and Limitations](#faq-known-issues-additional-considerations-and-limitations)
10. [Notices](#notices)
11. [Authors](#authors)

## Overview

Managing costs across multiple AWS accounts often requires finance teams to query data from several sources to get a complete view of spending and optimization opportunities. This Guidance demonstrates how to build a FinOps agent using **Amazon Bedrock AgentCore** that helps finance teams manage AWS costs across multiple accounts. The conversational agent consolidates data from **AWS Cost Explorer**, **AWS Budgets**, and **AWS Compute Optimizer** into a single interface, so teams can ask questions like "What are my top cost drivers this month?" and receive immediate answers.

The Guidance uses **Amazon Bedrock AgentCore Runtime** to host a custom agent built with the **Strands Agents SDK** and **Anthropic Claude Sonnet 4.5** on **Amazon Bedrock**. **Amazon Bedrock AgentCore Gateway** provides unified tool discovery and invocation, routing requests to two **Model Context Protocol (MCP)** server runtimes — one for AWS Billing and Cost Management and one for AWS Pricing. **Amazon Cognito** manages user authentication, and **AWS Amplify** hosts the web application frontend. **AgentCore Memory** retains 30 days of conversation context, enabling follow-up questions without repeating information. Over 20 specialized tools cover the full spectrum of cost management, from analysis to optimization.

### Architecture diagram

![Architecture diagram for Guidance for Building a FinOps Agent Using Amazon Bedrock AgentCore on AWS](assets/images/1.FinOpsAgentCoreAgent-Diagram.png)

The architecture contains five key sections:

1. **Amazon Cognito** authenticates users and provides temporary AWS credentials through Identity Pools. A machine-to-machine (M2M) client enables OAuth 2.0 flows between the Gateway and MCP runtimes.
2. **AWS CodeBuild** clones upstream AWS Labs MCP servers, applies a stdio-to-HTTP transformation, and builds AWS Graviton (ARM64) container images stored in **Amazon Elastic Container Registry (Amazon ECR)**.
3. Two **AgentCore Runtimes** host the transformed MCP servers (Billing and Pricing), each configured with JWT authorization using Amazon Cognito and specific **AWS Identity and Access Management (IAM)** permissions.
4. **AgentCore Gateway** provides a unified tool discovery and invocation endpoint with AWS_IAM authorization. **AgentCore Identity** manages the OAuth 2.0 credential lifecycle for secure communication between the Gateway and MCP server runtimes.
5. The main **AgentCore Runtime** hosts the Strands agent, which orchestrates model invocations and tool calls through the Gateway. **AgentCore Memory** maintains conversation history for up to 30 days.

### Cost

_You are responsible for the cost of the AWS services used while running this Guidance. As of April 2026, the cost for running this Guidance with the default settings in the US East (N. Virginia) Region is approximately $150–$250 per month, depending on usage volume._

The following table provides a sample cost breakdown for deploying this Guidance with the default parameters in the US East (N. Virginia) Region for one month.

| AWS service | Dimensions | Cost [USD] |
| --- | --- | --- |
| Amazon Bedrock (Claude Sonnet 4.5) | 1,000 agent invocations, ~2,000 input/output tokens each | ~$50.00 |
| Amazon Bedrock AgentCore Runtime | 3 runtimes (main agent + 2 MCP servers), always-on | ~$75.00 |
| Amazon Cognito | 100 active users, no advanced security | $0.00 |
| Amazon ECR | 3 container images, ~1 GB storage | ~$0.10 |
| AWS CodeBuild | 3 builds per deployment, ARM small instance | ~$0.50 |
| Amazon S3 | CodeBuild source scripts, <1 GB with versioning | ~$0.03 |
| AWS Lambda | Custom resource functions, minimal invocations | ~$0.00 |
| AWS Amplify | Frontend hosting, <1 GB transfer | ~$0.00 |
| **Total estimated monthly cost** | | **~$125.63** |

_We recommend creating a [Budget](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) through [AWS Cost Explorer](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/) to help manage costs. Prices are subject to change. For full details, refer to the pricing webpage for each AWS service used in this Guidance._

## Prerequisites

### Operating System

These deployment instructions are optimized to best work on **Amazon Linux 2023**. Deployment on Mac or Windows may require additional steps.

### Third-party tools

- [Node.js](https://nodejs.org/) v18 or later and [npm](https://www.npmjs.com/)
- [Python](https://www.python.org/) 3.13 or higher
- [Docker](https://www.docker.com/) (required for container image builds via AWS CodeBuild)

### AWS account requirements

- An [AWS account](https://aws.amazon.com/free/) with permissions for the following services:
  - Amazon Bedrock (with model access enabled for Anthropic Claude Sonnet 4.5)
  - Amazon Bedrock AgentCore
  - Amazon Cognito
  - Amazon ECR
  - AWS CodeBuild
  - AWS Lambda
  - Amazon S3
  - AWS IAM
  - AWS CloudFormation
  - Amazon CloudWatch Logs
  - AWS Secrets Manager
- [AWS CLI](https://aws.amazon.com/cli/) v2.x installed and configured with credentials
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) v2.x installed globally:

  ```bash
  npm install -g aws-cdk
  ```

### AWS CDK bootstrap

If you are using AWS CDK for the first time in your account and Region, bootstrap your environment:

```bash
cdk bootstrap aws://ACCOUNT-NUMBER/us-east-1
```

Replace `ACCOUNT-NUMBER` with your 12-digit AWS account ID.

### Supported Regions

This Guidance deploys to the **US East (N. Virginia) / us-east-1** Region. Amazon Bedrock AgentCore availability may vary by Region. Verify service availability before deploying to other Regions.

## Automated Deployment

For automated deployment, a one-click deploy script (`deploy.sh`) is available. This script automates all deployment steps including dependency installation, resource creation, and validation.

**Usage:**

```bash
# Clone the repository
git clone https://github.com/aws-samples/sample-finops-agent-amazon-bedrock-agentcore
cd sample-finops-agent-amazon-bedrock-agentcore

# Make the script executable and run it
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

**What the script does:**
- Detects your platform (macOS, Linux, Windows WSL)
- Checks all prerequisites (AWS CLI, Node.js, Python, CDK)
- Prompts for your email address and AWS Region
- Installs CDK dependencies and builds TypeScript
- Bootstraps CDK if needed
- Deploys all five CloudFormation stacks
- Displays stack outputs for frontend configuration

**Environment:**
- Supports macOS, Linux, and Windows (WSL/Git Bash)
- Requires AWS CLI configured with appropriate credentials

For a detailed understanding of each deployment step, see the [Manual Deployment](#manual-deployment) section below.

## Manual Deployment

### Step 1: Clone the repository

```bash
git clone https://github.com/aws-samples/sample-finops-agent-amazon-bedrock-agentcore
cd sample-finops-agent-amazon-bedrock-agentcore
```

### Step 2: Set environment variables

Set your email address to receive the temporary admin password for Amazon Cognito:

```bash
export ADMIN_EMAIL="your-email@example.com"
```

### Step 3: Install CDK dependencies

```bash
cd cdk
npm install
```

### Step 4: Build the TypeScript code

```bash
npm run build
```

### Step 5: Bootstrap CDK (if not already done)

```bash
npx cdk bootstrap
```

### Step 6: Deploy all stacks

```bash
npx cdk deploy --all --require-approval never
```

The deployment provisions five CloudFormation stacks in sequence:

1. **FinOpsImageStack** — ECR repositories and CodeBuild projects for container images
2. **FinOpsAuthStack** — Amazon Cognito User Pool, Identity Pool, M2M client, and IAM roles
3. **FinOpsMCPRuntimeStack** — Two AgentCore Runtimes for Billing and Pricing MCP servers
4. **FinOpsAgentCoreGatewayStack** — AgentCore Gateway with OAuth provider and MCP server targets
5. **FinOpsAgentRuntimeStack** — Main agent runtime with Gateway integration and AgentCore Memory

The deployment takes approximately 15–20 minutes.

### Step 7: Note the stack outputs

After the final stack (`FinOpsAgentRuntimeStack`) deploys, note the following outputs from the terminal:

- `UserPoolId` — Cognito User Pool ID
- `UserPoolClientId` — Cognito User Pool Client ID
- `IdentityPoolId` — Cognito Identity Pool ID
- `AgentCoreArn` — AgentCore Runtime ARN

You receive an email at the address you specified with a temporary password for the admin user.

### Step 8: Deploy the Amplify frontend

1. Download `AWS-Amplify-Frontend.zip` from the `amplify-frontend/` directory in this repository.
2. Open the [AWS Amplify console](https://console.aws.amazon.com/amplify/).
3. Choose **Deploy without Git provider**.
4. Upload the `.zip` file and wait for deployment to complete.
5. Note the generated domain URL.

## Deployment Validation

1. Open the [AWS CloudFormation console](https://console.aws.amazon.com/cloudformation/) and verify all five stacks show a status of `CREATE_COMPLETE`:
   - `FinOpsImageStack`
   - `FinOpsAuthStack`
   - `FinOpsMCPRuntimeStack`
   - `FinOpsAgentCoreGatewayStack`
   - `FinOpsAgentRuntimeStack`

2. Run the following CLI command to confirm the main agent runtime is active:

   ```bash
   aws bedrock-agentcore get-runtime --runtime-name finops_runtime --query 'status' --output text
   ```

   Expected output: `ACTIVE`

3. Verify the ECR repositories contain images:

   ```bash
   aws ecr list-images --repository-name finops-agent-runtime --query 'imageIds[0].imageTag' --output text
   aws ecr list-images --repository-name finops-billing-mcp-runtime --query 'imageIds[0].imageTag' --output text
   aws ecr list-images --repository-name finops-pricing-mcp-runtime --query 'imageIds[0].imageTag' --output text
   ```

   Each command should return `latest`.

4. Open the Amplify application URL in a browser and confirm the login page loads.

## Running the Guidance

### Configure the frontend

Open the Amplify application URL. Enter the Amazon Cognito and AgentCore configuration values from the stack outputs:

- **User Pool ID**
- **User Pool Client ID**
- **Identity Pool ID**
- **AgentCore ARN**

From the **Agent Type** menu, select **AgentCore Agent**, enter the deployment Region (`us-east-1`), and choose an agent name. Save the configuration.

### Sign in and interact

Sign in with the username `admin` and the temporary password sent to your email. Reset your password at first sign-in.

**Sample queries to try:**

| Query | Tools used |
| --- | --- |
| "What are my AWS costs for January 2026?" | `get_cost_and_usage` |
| "What are my current cost savings opportunities?" | `get_rightsizing_recommendations`, `get_savings_plans_recommendations`, `get_compute_optimizer_recommendations` |
| "Show me my costs by Region for the last 30 days" | `get_cost_and_usage` |
| "What's my cost forecast for the next 3 months?" | `get_cost_forecast` |
| "Compare pricing for t3.micro and t3.small instances" | `get_pricing` |
| "Are there any cost anomalies in my account?" | `get_anomalies` |
| "What's my free tier usage status?" | `get_free_tier_usage` |
| "Show me my budgets and their current status" | `describe_budgets` |

### Conversational memory

AgentCore Memory maintains context across multiple questions within a session:

- **You:** "What are my top 5 services by cost?"
- **Agent:** _(Provides list of top 5 services)_
- **You:** "What about the second one?"
- **Agent:** _(Remembers the previous list and provides details about the second service)_
- **You:** "How can I optimize it?"
- **Agent:** _(Provides optimization recommendations for that specific service)_

Memory retains 30 days of conversation history. The Strands session manager retrieves relevant context for each request automatically.

## Next Steps

- **Add more MCP servers:** Extend the Gateway with additional MCP server targets for services like AWS Trusted Advisor, AWS Security Hub, or custom internal tools.
- **Customize the agent prompt:** Modify the system prompt in `agentcore/agent_runtime.py` to tailor the agent's behavior for your organization's specific FinOps policies.
- **Enable multi-account support:** Configure cross-account IAM roles to allow the agent to query cost data across your AWS Organization.
- **Integrate with enterprise tools:** Replace the Amplify frontend with your existing enterprise communication tools (Slack, Microsoft Teams) using the AgentCore Runtime API.
- **Add MFA to Amazon Cognito:** Enable multi-factor authentication on the Cognito User Pool for production deployments.
- **Enable advanced security features:** Turn on Amazon Cognito advanced security for compromised credential detection in production.

## Cleanup

To avoid incurring future charges, delete the resources created by this Guidance.

### Step 1: Destroy the CDK stacks

```bash
cd sample-finops-agent-amazon-bedrock-agentcore/cdk
npx cdk destroy --all
```

When prompted, type `y` to confirm deletion of all five stacks:

```
Are you sure you want to delete: FinOpsAgentRuntimeStack, FinOpsAgentCoreGatewayStack, FinOpsMCPRuntimeStack, FinOpsAuthStack, FinOpsImageStack (y/n)?
```

### Step 2: Delete the Amplify application

1. Open the [AWS Amplify console](https://console.aws.amazon.com/amplify/).
2. Select your application.
3. Choose **App settings** > **General settings**.
4. Choose **Delete app**.

### Step 3: Verify resource deletion

Confirm that no orphaned resources remain:

```bash
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[?starts_with(StackName, 'FinOps')].StackName" --output text
```

This command should return no results. If any stacks remain, delete them manually from the CloudFormation console.

## FAQ, Known Issues, Additional Considerations, and Limitations

**Known issues:**

- The CodeBuild image build process for MCP servers takes approximately 10–15 minutes per server. If the build times out, increase the `MaxWaitSeconds` parameter in the CDK stack or re-run the deployment.
- Amazon Bedrock model access must be enabled manually in the Amazon Bedrock console before deployment. If the agent returns errors about model access, verify that Anthropic Claude Sonnet 4.5 is enabled in the us-east-1 Region.

**Additional considerations:**

- This Guidance creates Amazon Cognito resources without MFA enforcement and without advanced security features. Enable both for production deployments.
- The Billing MCP Runtime has broad permissions for Cost Explorer, Budgets, Compute Optimizer, and related services (`ce:*`, `budgets:*`, `compute-optimizer:*`). Scope these permissions down for production use.
- AgentCore Runtimes are configured with public network access. Consider using private networking for production deployments.
- The dataset used by this Guidance is your actual AWS billing data. No synthetic data is required.

For any feedback, questions, or suggestions, use the [Issues](https://github.com/aws-samples/sample-finops-agent-amazon-bedrock-agentcore/issues) tab in this repository.

## Notices

*Customers are responsible for making their own independent assessment of the information in this Guidance. This Guidance: (a) is for informational purposes only, (b) represents AWS current product offerings and practices, which are subject to change without notice, and (c) does not create any commitments or assurances from AWS and its affiliates, suppliers or licensors. AWS products or services are provided "as is" without warranties, representations, or conditions of any kind, whether express or implied. AWS responsibilities and liabilities to its customers are controlled by AWS agreements, and this Guidance is not part of, nor does it modify, any agreement between AWS and its customers.*

## Authors

- **Salman Ahmed** — Senior Technical Account Manager, AWS
- **Ravi Kumar** — Senior Technical Account Manager, AWS
- **Sergio Barraza** — Senior Technical Account Manager, AWS
