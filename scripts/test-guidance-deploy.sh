#!/bin/bash
set -e

# ============================================
# Guidance for Building a FinOps Agent Using
# Amazon Bedrock AgentCore on AWS
# Internal Test Deploy Script (CodeBuild)
# ============================================
# Target: CodeBuild Amazon Linux 2023
# Image: aws/codebuild/amazonlinux-x86_64-standard:5.0
# Privileged: true
# Region: us-east-1
# ============================================

# ============================================
# CONFIGURATION
# ============================================
export AWS_REGION="us-east-1"
EMAIL_ADDRESS="wwso-guidance-deployments-ignore@amazon.com"
TIMESTAMP=$(date +%s)

# ============================================
# ENVIRONMENT SETUP
# ============================================
echo "============================================"
echo "Environment Setup"
echo "============================================"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: $ACCOUNT_ID"
echo "Region: $AWS_REGION"
echo "Timestamp: $TIMESTAMP"

# ============================================
# INSTALL DEPENDENCIES
# ============================================
echo ""
echo "============================================"
echo "Installing dependencies..."
echo "============================================"

echo "Installing Node.js and npm..."
if ! command -v node &> /dev/null; then
    # Download setup script first, then execute (avoids curl-pipe-bash pattern)
    NODESOURCE_SCRIPT=$(mktemp)
    curl -fsSL https://rpm.nodesource.com/setup_18.x -o "$NODESOURCE_SCRIPT"
    bash "$NODESOURCE_SCRIPT"
    rm -f "$NODESOURCE_SCRIPT"
    dnf install -y nodejs
fi
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

echo "Installing AWS CDK..."
npm install -g aws-cdk
echo "CDK version: $(cdk --version)"

echo "Installing Python 3..."
if ! command -v python3 &> /dev/null; then
    dnf install -y python3
fi
echo "Python version: $(python3 --version)"

# ============================================
# CDK BOOTSTRAP CHECK
# ============================================
echo ""
echo "============================================"
echo "Checking CDK bootstrap..."
echo "============================================"
CDK_BOOTSTRAP_STACK=$(aws cloudformation describe-stacks --region "$AWS_REGION" \
    --query "Stacks[?StackName=='CDKToolkit'].StackName" --output text 2>/dev/null || true)
if [ -z "$CDK_BOOTSTRAP_STACK" ] || [ "$CDK_BOOTSTRAP_STACK" = "None" ]; then
    echo "Running CDK bootstrap..."
    cdk bootstrap "aws://$ACCOUNT_ID/$AWS_REGION"
else
    echo "CDK already bootstrapped"
fi

# ============================================
# DEPLOYMENT
# ============================================
echo ""
echo "============================================"
echo "Deploying FinOps Agent stacks..."
echo "============================================"

export ADMIN_EMAIL="$EMAIL_ADDRESS"

cd cdk
echo "Installing CDK dependencies..."
npm install

echo "Building TypeScript..."
npm run build

echo "Deploying all stacks..."
npx cdk deploy --all --require-approval never

# ============================================
# VALIDATION
# ============================================
echo ""
echo "============================================"
echo "Validating deployment..."
echo "============================================"

# Verify all stacks are CREATE_COMPLETE
STACKS=("FinOpsImageStack" "FinOpsAuthStack" "FinOpsMCPRuntimeStack" "FinOpsAgentCoreGatewayStack" "FinOpsAgentRuntimeStack")
ALL_PASSED=true

for STACK in "${STACKS[@]}"; do
    STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK" \
        --region "$AWS_REGION" \
        --query "Stacks[0].StackStatus" \
        --output text 2>/dev/null || echo "NOT_FOUND")
    if [ "$STATUS" = "CREATE_COMPLETE" ] || [ "$STATUS" = "UPDATE_COMPLETE" ]; then
        echo "  ✅ $STACK: $STATUS"
    else
        echo "  ❌ $STACK: $STATUS"
        ALL_PASSED=false
    fi
done

# Verify ECR images exist
echo ""
echo "Checking ECR images..."
for REPO in "finops-agent-runtime" "finops-billing-mcp-runtime" "finops-pricing-mcp-runtime"; do
    IMAGE_TAG=$(aws ecr list-images --repository-name "$REPO" \
        --query 'imageIds[0].imageTag' --output text 2>/dev/null || echo "NOT_FOUND")
    if [ "$IMAGE_TAG" = "latest" ]; then
        echo "  ✅ $REPO: image found"
    else
        echo "  ⚠️  $REPO: image tag=$IMAGE_TAG"
    fi
done

if [ "$ALL_PASSED" = true ]; then
    echo ""
    echo "============================================"
    echo "Deployment completed successfully!"
    echo "============================================"
else
    echo ""
    echo "============================================"
    echo "WARNING: Some stacks did not deploy successfully."
    echo "============================================"
    exit 1
fi

# ============================================
# CLEANUP
# ============================================
echo ""
echo "============================================"
echo "Cleaning up resources..."
echo "============================================"

echo "Destroying all stacks..."
npx cdk destroy --all --force

echo ""
echo "Verifying cleanup..."
for STACK in "${STACKS[@]}"; do
    STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK" \
        --region "$AWS_REGION" \
        --query "Stacks[0].StackStatus" \
        --output text 2>/dev/null || echo "DELETED")
    echo "  $STACK: $STATUS"
done

echo ""
echo "Test deployment and cleanup completed."
