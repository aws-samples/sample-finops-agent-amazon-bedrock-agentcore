#!/bin/bash
set -e

echo "=== FinOps Agent CDK Deployment ==="
echo ""

# Determine script directory and repository root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Always unset ADMIN_EMAIL to force prompt
unset ADMIN_EMAIL

# Prompt for admin email if not set
if [ -z "$ADMIN_EMAIL" ]; then
    echo "Please enter the admin email address for Cognito:"
    read -p "Email: " ADMIN_EMAIL
    export ADMIN_EMAIL
fi

# Validate email is not empty
if [ -z "$ADMIN_EMAIL" ]; then
    echo "❌ Error: Email address cannot be empty"
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
echo "This will deploy 3 stacks:"
echo "  1. FinOpsImageStack (ECR + CodeBuild)"
echo "  2. FinOpsAgentStack (Runtime + Gateway + Lambdas)"
echo "  3. FinOpsAuthStack (Cognito)"
echo ""
read -p "Continue with deployment? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Deployment cancelled"
    exit 0
fi

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

# Deploy all stacks
echo ""
echo "Deploying All Stacks..."
echo ""

npx cdk deploy --all --require-approval never

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Next Steps:"
echo "1. Check your email ($ADMIN_EMAIL) for temporary password"
echo "2. Use the Runtime ARN from outputs to connect your frontend"
echo "3. Monitor logs in CloudWatch"
echo ""
echo "To view outputs:"
echo "  aws cloudformation describe-stacks --stack-name FinOpsAgentStack --query 'Stacks[0].Outputs'"
echo ""
