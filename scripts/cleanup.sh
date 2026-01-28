#!/bin/bash
set -e

echo "=== FinOps Agent CDK Cleanup ==="
echo ""
echo "⚠️  WARNING: This will destroy all FinOps Agent resources!"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Cleanup cancelled."
    exit 0
fi

echo ""
echo "Destroying all stacks in reverse order..."
echo ""

# Determine script directory (not used but good practice)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

AWS_REGION=${AWS_REGION:-us-east-1}

# Destroy stacks in reverse order: Auth -> Agent -> Image
echo "1/3 Destroying FinOpsAuthStack..."
aws cloudformation delete-stack --stack-name FinOpsAuthStack --region $AWS_REGION
aws cloudformation wait stack-delete-complete --stack-name FinOpsAuthStack --region $AWS_REGION
echo "✅ FinOpsAuthStack deleted"

echo ""
echo "2/3 Destroying FinOpsAgentStack..."
aws cloudformation delete-stack --stack-name FinOpsAgentStack --region $AWS_REGION
aws cloudformation wait stack-delete-complete --stack-name FinOpsAgentStack --region $AWS_REGION
echo "✅ FinOpsAgentStack deleted"

echo ""
echo "3/3 Destroying FinOpsImageStack..."
aws cloudformation delete-stack --stack-name FinOpsImageStack --region $AWS_REGION
aws cloudformation wait stack-delete-complete --stack-name FinOpsImageStack --region $AWS_REGION
echo "✅ FinOpsImageStack deleted"

echo ""
echo "=== Cleanup Complete ==="
echo ""
echo "All FinOps Agent resources have been removed."
echo ""
