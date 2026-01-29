#!/bin/bash
set -e

echo "=== FinOps Agent CDK Deployment ==="
echo ""

# Determine script directory and repository root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Prompt for admin email if not set
if [ -z "$ADMIN_EMAIL" ]; then
    read -p "Enter admin email address: " ADMIN_EMAIL
    export ADMIN_EMAIL
fi

# Validate email is not empty
if [ -z "$ADMIN_EMAIL" ]; then
    echo "❌ Error: Admin email cannot be empty"
    exit 1
fi

# Get AWS account and region
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}

echo ""
echo "AWS Account: $AWS_ACCOUNT"
echo "AWS Region: $AWS_REGION"
echo "Admin Email: $ADMIN_EMAIL"
echo ""

# Navigate to CDK directory
cd "$REPO_ROOT/cdk"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing CDK dependencies..."
    npm install
fi

# Build TypeScript
echo "Building CDK project..."
npm run build

# Bootstrap CDK (if not already done)
echo "Checking CDK bootstrap..."
npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION || true

# Deploy all stacks
echo ""
echo "Deploying All Stacks..."
echo ""

npx cdk deploy --all --require-approval never

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Stack Information:"
echo "  Image Stack:  FinOpsImageStack"
echo "  Agent Stack:  FinOpsAgentStack"
echo "  Auth Stack:   FinOpsAuthStack"
echo ""

# Fetch outputs from stacks
echo "Fetching stack outputs..."
AGENT_OUTPUTS=$(aws cloudformation describe-stacks --stack-name FinOpsAgentStack --query 'Stacks[0].Outputs' --output json 2>/dev/null || echo "[]")
AUTH_OUTPUTS=$(aws cloudformation describe-stacks --stack-name FinOpsAuthStack --query 'Stacks[0].Outputs' --output json 2>/dev/null || echo "[]")

# Extract values using jq if available, otherwise use grep
if command -v jq &> /dev/null; then
    RUNTIME_ARN=$(echo "$AGENT_OUTPUTS" | jq -r '.[] | select(.OutputKey=="RuntimeArn") | .OutputValue' 2>/dev/null || echo "N/A")
    USER_POOL_ID=$(echo "$AUTH_OUTPUTS" | jq -r '.[] | select(.OutputKey=="UserPoolId") | .OutputValue' 2>/dev/null || echo "N/A")
    USER_POOL_CLIENT_ID=$(echo "$AUTH_OUTPUTS" | jq -r '.[] | select(.OutputKey=="UserPoolClientId") | .OutputValue' 2>/dev/null || echo "N/A")
    IDENTITY_POOL_ID=$(echo "$AUTH_OUTPUTS" | jq -r '.[] | select(.OutputKey=="IdentityPoolId") | .OutputValue' 2>/dev/null || echo "N/A")
else
    RUNTIME_ARN="(run command below to get value)"
    USER_POOL_ID="(run command below to get value)"
    USER_POOL_CLIENT_ID="(run command below to get value)"
    IDENTITY_POOL_ID="(run command below to get value)"
fi

echo "Next Steps:"
echo "1. Check your email ($ADMIN_EMAIL) for temporary password"
echo ""
echo "2. Use these values to configure your frontend application:"
echo "   • User Pool ID: $USER_POOL_ID"
echo "   • User Pool Client ID: $USER_POOL_CLIENT_ID"
echo "   • Identity Pool ID: $IDENTITY_POOL_ID"
echo "   • Region: $AWS_REGION"
echo "   • Agent Name: finops_runtime"
echo "   • AgentCore ARN: $RUNTIME_ARN"
echo ""
echo "3. Monitor logs in CloudWatch"
echo ""
echo "To view all outputs manually:"
echo "  aws cloudformation describe-stacks --stack-name FinOpsAgentStack --query 'Stacks[0].Outputs'"
echo "  aws cloudformation describe-stacks --stack-name FinOpsAuthStack --query 'Stacks[0].Outputs'"
echo ""
