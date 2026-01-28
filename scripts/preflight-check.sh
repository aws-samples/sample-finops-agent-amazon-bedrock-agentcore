#!/bin/bash

echo "=== FinOps Agent Pre-Flight Check ==="
echo ""

ERRORS=0
WARNINGS=0

# Check AWS CLI
echo "Checking AWS CLI..."
if command -v aws &> /dev/null; then
    AWS_VERSION=$(aws --version 2>&1 | cut -d' ' -f1)
    echo "✅ AWS CLI installed: $AWS_VERSION"
else
    echo "❌ AWS CLI not found"
    ERRORS=$((ERRORS + 1))
fi

# Check AWS credentials
echo ""
echo "Checking AWS credentials..."
if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    USER=$(aws sts get-caller-identity --query Arn --output text)
    echo "✅ AWS credentials configured"
    echo "   Account: $ACCOUNT"
    echo "   User: $USER"
else
    echo "❌ AWS credentials not configured"
    ERRORS=$((ERRORS + 1))
fi

# Check Node.js
echo ""
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js installed: $NODE_VERSION"
    
    # Check version is >= 18
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo "⚠️  Warning: Node.js 18+ recommended (you have v$NODE_MAJOR)"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo "❌ Node.js not found"
    ERRORS=$((ERRORS + 1))
fi

# Check npm
echo ""
echo "Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✅ npm installed: $NPM_VERSION"
else
    echo "❌ npm not found"
    ERRORS=$((ERRORS + 1))
fi

# Check Python
echo ""
echo "Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "✅ Python installed: $PYTHON_VERSION"
else
    echo "❌ Python 3 not found"
    ERRORS=$((ERRORS + 1))
fi

# Check CDK
echo ""
echo "Checking AWS CDK..."
if npm list -g aws-cdk &> /dev/null; then
    CDK_VERSION=$(npm list -g aws-cdk 2>/dev/null | grep aws-cdk@ | cut -d'@' -f2)
    echo "✅ AWS CDK installed: $CDK_VERSION"
else
    echo "⚠️  AWS CDK not found globally"
    echo "   Install with: npm install -g aws-cdk"
    WARNINGS=$((WARNINGS + 1))
fi

# Check region
echo ""
echo "Checking AWS region..."
if [ -z "$AWS_REGION" ]; then
    DEFAULT_REGION=$(aws configure get region 2>/dev/null || echo "not set")
    if [ "$DEFAULT_REGION" = "not set" ]; then
        echo "⚠️  AWS_REGION not set"
        echo "   Set with: export AWS_REGION=us-east-1"
        WARNINGS=$((WARNINGS + 1))
    else
        echo "✅ AWS region: $DEFAULT_REGION (from AWS config)"
        if [ "$DEFAULT_REGION" != "us-east-1" ]; then
            echo "⚠️  Warning: This solution is designed for us-east-1"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
else
    echo "✅ AWS region: $AWS_REGION"
    if [ "$AWS_REGION" != "us-east-1" ]; then
        echo "⚠️  Warning: This solution is designed for us-east-1"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# Check ADMIN_EMAIL
echo ""
echo "Checking ADMIN_EMAIL..."
if [ -z "$ADMIN_EMAIL" ]; then
    echo "⚠️  ADMIN_EMAIL not set"
    echo "   Set with: export ADMIN_EMAIL='your-email@example.com'"
    WARNINGS=$((WARNINGS + 1))
else
    echo "✅ ADMIN_EMAIL set: $ADMIN_EMAIL"
fi

# Check file structure
echo ""
echo "Checking file structure..."
MISSING_FILES=0

check_file() {
    if [ -f "$1" ]; then
        echo "✅ $1"
    else
        echo "❌ $1 (missing)"
        MISSING_FILES=$((MISSING_FILES + 1))
    fi
}

check_file "agentcore/agent_runtime.py"
check_file "lambda/billing_mcp_server.py"
check_file "lambda/pricing_mcp_server.py"
check_file "cdk/lib/agent-stack.ts"
check_file "scripts/deploy.sh"

if [ $MISSING_FILES -gt 0 ]; then
    ERRORS=$((ERRORS + MISSING_FILES))
fi

# Summary
echo ""
echo "=== Pre-Flight Check Summary ==="
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "✅ All checks passed! Ready to deploy."
    echo ""
    echo "To deploy, run:"
    echo "  export ADMIN_EMAIL='your-email@example.com'"
    echo "  export AWS_REGION='us-east-1'"
    echo "  ./scripts/deploy.sh"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "⚠️  $WARNINGS warning(s) found, but you can proceed."
    echo ""
    echo "To deploy, run:"
    echo "  export ADMIN_EMAIL='your-email@example.com'"
    echo "  export AWS_REGION='us-east-1'"
    echo "  ./scripts/deploy.sh"
    exit 0
else
    echo "❌ $ERRORS error(s) found. Please fix before deploying."
    if [ $WARNINGS -gt 0 ]; then
        echo "⚠️  $WARNINGS warning(s) also found."
    fi
    exit 1
fi
