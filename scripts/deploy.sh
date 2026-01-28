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
echo "Next Steps:"
echo "1. Check your email ($ADMIN_EMAIL) for temporary password"
echo "2. Use the Runtime ARN from outputs to connect your frontend"
echo "3. Monitor logs in CloudWatch"
echo ""
echo "To view outputs:"
echo "  aws cloudformation describe-stacks --stack-name FinOpsAgentStack --query 'Stacks[0].Outputs'"
echo ""
