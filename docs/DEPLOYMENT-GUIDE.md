# Deployment Guide

This guide provides step-by-step instructions for deploying the FinOps Agent solution.

## Prerequisites

Before you begin, ensure you have:

- **AWS Account** with appropriate permissions
- **AWS CLI** installed and configured
- **Node.js** (v18 or later) and npm
- **Python 3.13** installed
- **AWS CDK** installed globally: `npm install -g aws-cdk`
- **Access to Amazon Bedrock** with Nova Pro model enabled in us-east-1
- **IAM Permissions** to create:
  - Amazon Bedrock AgentCore resources
  - Amazon ECR repositories
  - AWS Lambda functions
  - Amazon Cognito resources
  - IAM roles and policies
  - Amazon ECS tasks and services
  - AWS CodeBuild projects

## Deployment Steps

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd finops-agentcore-solution
```

### Step 2: Set Environment Variables

```bash
export ADMIN_EMAIL="your-email@example.com"
export AWS_REGION="us-east-1"
```

### Step 3: Install CDK Dependencies

```bash
cd cdk
npm install
cd ..
```

### Step 4: Deploy Using Script

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

The deployment script will:
1. Install CDK dependencies
2. Build TypeScript code
3. Bootstrap CDK (if needed)
4. Deploy ImageStack (creates ECR and builds container)
5. Deploy AgentStack (creates Runtime, Gateway, Memory, Lambdas)
6. Deploy AuthStack (creates Cognito resources)

**Deployment time:** Approximately 15-20 minutes

### Step 5: Note the Outputs

After deployment completes, save these outputs from the CloudFormation console:

**From AgentStack:**
- `RuntimeArn` - AgentCore Runtime ARN
- `GatewayArn` - Gateway ARN
- `MemoryId` - Memory ID

**From AuthStack:**
- `UserPoolId` - Cognito User Pool ID
- `UserPoolClientId` - App Client ID
- `IdentityPoolId` - Identity Pool ID
- `AdminUsername` - Admin user name

You will receive an email with a temporary password.

### Step 6: Deploy Frontend

```bash
cd frontend
npm install
npm run build
```

Deploy to AWS Amplify:
1. Navigate to AWS Amplify console
2. Choose "Deploy without Git provider"
3. Upload the `dist` folder as a .zip file
4. Wait for deployment to complete
5. Note the Amplify domain URL

### Step 7: Configure Frontend

When you first access the Amplify URL, enter the configuration values from Step 5.

### Step 8: First Login

1. Use username: `admin`
2. Use the temporary password from email
3. You'll be prompted to change your password
4. Start asking questions!

## Verification

Test the deployment:

```bash
# Test with AWS SDK
python examples/python-client.py
```

Or use the web interface to ask:
- "What are my AWS costs for last month?"
- "Show me cost optimization opportunities"

## Troubleshooting

### Deployment Fails

**Issue:** CodeBuild fails to build container
**Solution:** Check CloudWatch logs for CodeBuild project

**Issue:** CDK bootstrap required
**Solution:** Run `cdk bootstrap aws://ACCOUNT-ID/us-east-1`

### Runtime Not Working

**Issue:** Gateway ARN not configured
**Solution:** Verify environment variables in AgentStack

**Issue:** Tools not accessible
**Solution:** Check Gateway target configuration and Lambda permissions

### Authentication Issues

**Issue:** Cannot log in
**Solution:** Verify Cognito User Pool configuration and check email for temporary password

## Monitoring

Monitor your deployment:

```bash
# Runtime logs
aws logs tail /aws/bedrock-agentcore/runtime/finops-runtime --follow

# Billing Lambda logs
aws logs tail /aws/lambda/FinOpsAgentStack-billing-mcp --follow

# Pricing Lambda logs
aws logs tail /aws/lambda/FinOpsAgentStack-pricing-mcp --follow
```

## Next Steps

- Review [TOOL-REFERENCE.md](TOOL-REFERENCE.md) for available tools
- Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues
- Read [ARCHITECTURE.md](../ARCHITECTURE.md) for architecture details

## Cleanup

To remove all resources:

```bash
chmod +x scripts/cleanup.sh
./scripts/cleanup.sh
```

This will destroy all three CDK stacks and clean up resources.
