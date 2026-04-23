#!/bin/bash
set -e

# ============================================
# Guidance for Building a FinOps Agent Using
# Amazon Bedrock AgentCore on AWS
# User-Facing Deploy Script
# ============================================

# ============================================
# CONFIGURATION
# ============================================
AWS_REGION="${AWS_REGION:-us-east-1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"

# ============================================
# PLATFORM DETECTION
# ============================================
detect_platform() {
    case "$(uname -s)" in
        Darwin*)  PLATFORM="macos" ;;
        Linux*)   PLATFORM="linux" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *)        PLATFORM="unknown" ;;
    esac
    echo "Detected platform: $PLATFORM"
}

# ============================================
# PREREQUISITE CHECKS
# ============================================
check_prerequisites() {
    echo "============================================"
    echo "Checking prerequisites..."
    echo "============================================"

    command -v aws >/dev/null 2>&1 || { echo "ERROR: AWS CLI is required. Install: https://aws.amazon.com/cli/"; exit 1; }
    echo "  ✅ AWS CLI found: $(aws --version 2>&1 | head -1)"

    command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required. Install: https://nodejs.org/"; exit 1; }
    echo "  ✅ Node.js found: $(node --version)"

    command -v npm >/dev/null 2>&1 || { echo "ERROR: npm is required. Install with Node.js: https://nodejs.org/"; exit 1; }
    echo "  ✅ npm found: $(npm --version)"

    command -v python3 >/dev/null 2>&1 || { echo "ERROR: Python 3 is required. Install: https://www.python.org/"; exit 1; }
    echo "  ✅ Python found: $(python3 --version)"

    command -v cdk >/dev/null 2>&1 || {
        echo "  ⚠️  AWS CDK not found globally. Installing..."
        npm install -g aws-cdk
    }
    echo "  ✅ AWS CDK found: $(cdk --version 2>&1 | head -1)"

    # Verify AWS credentials
    aws sts get-caller-identity > /dev/null 2>&1 || { echo "ERROR: AWS credentials not configured. Run 'aws configure' first."; exit 1; }
    echo "  ✅ AWS credentials configured"
}

# ============================================
# PROMPT FOR CONFIGURATION
# ============================================
prompt_configuration() {
    echo ""
    echo "============================================"
    echo "Configuration"
    echo "============================================"

    if [ -z "$ADMIN_EMAIL" ]; then
        read -p "Enter your email address (for Cognito admin user): " ADMIN_EMAIL
        if [ -z "$ADMIN_EMAIL" ]; then
            echo "ERROR: Email address is required."
            exit 1
        fi
    fi
    echo "  Admin email: $ADMIN_EMAIL"

    read -p "AWS Region [$AWS_REGION]: " INPUT_REGION
    if [ -n "$INPUT_REGION" ]; then
        AWS_REGION="$INPUT_REGION"
    fi
    echo "  Region: $AWS_REGION"

    export AWS_REGION
    export ADMIN_EMAIL
}

# ============================================
# MAIN DEPLOYMENT
# ============================================
deploy() {
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo ""
    echo "============================================"
    echo "Deploying FinOps Agent"
    echo "============================================"
    echo "  Account: $ACCOUNT_ID"
    echo "  Region:  $AWS_REGION"
    echo "  Email:   $ADMIN_EMAIL"
    echo ""

    # Navigate to CDK directory
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    cd "$PROJECT_DIR/cdk"

    echo "Installing CDK dependencies..."
    npm install

    echo "Building TypeScript..."
    npm run build

    # Check CDK bootstrap
    echo "Checking CDK bootstrap status..."
    CDK_BOOTSTRAP_STACK=$(aws cloudformation describe-stacks --region "$AWS_REGION" \
        --query "Stacks[?StackName=='CDKToolkit'].StackName" --output text 2>/dev/null || true)
    if [ -z "$CDK_BOOTSTRAP_STACK" ] || [ "$CDK_BOOTSTRAP_STACK" = "None" ]; then
        echo "Running CDK bootstrap..."
        npx cdk bootstrap "aws://$ACCOUNT_ID/$AWS_REGION"
    else
        echo "  ✅ CDK already bootstrapped"
    fi

    echo ""
    echo "Deploying all stacks (this takes approximately 15-20 minutes)..."
    npx cdk deploy --all --require-approval never

    echo ""
    echo "============================================"
    echo "Deployment complete!"
    echo "============================================"
    echo ""

    # Capture outputs
    echo "Stack outputs:"
    echo "---"
    aws cloudformation describe-stacks \
        --stack-name FinOpsAgentRuntimeStack \
        --region "$AWS_REGION" \
        --query "Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}" \
        --output table 2>/dev/null || echo "  (Run 'aws cloudformation describe-stacks --stack-name FinOpsAgentRuntimeStack' to view outputs)"

    echo ""
    echo "Next steps:"
    echo "  1. Check your email ($ADMIN_EMAIL) for the temporary Cognito password"
    echo "  2. Deploy the Amplify frontend (see README for instructions)"
    echo "  3. Configure the frontend with the stack outputs above"
    echo ""
    echo "To clean up resources:"
    echo "  cd cdk && npx cdk destroy --all"
}

# ============================================
# RUN
# ============================================
detect_platform
check_prerequisites
prompt_configuration
deploy
