#!/bin/bash
# Example cURL commands for testing the FinOps Agent

# Configuration
RUNTIME_ARN="arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/finops_runtime-xxx"
AWS_REGION="us-east-1"

# Note: These examples use AWS CLI to sign requests
# You need AWS CLI configured with appropriate credentials

echo "FinOps Agent cURL Examples"
echo "=========================="
echo ""

# Example 1: Simple cost query
echo "Example 1: What are my costs for last month?"
echo "-------------------------------------------"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "What are my AWS costs for last month?" \
  --session-id "curl-example-1" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

# Example 2: Service breakdown
echo "Example 2: Top services by cost"
echo "-------------------------------"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "What are my top 10 services by cost?" \
  --session-id "curl-example-2" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

# Example 3: Regional costs
echo "Example 3: Costs by region"
echo "-------------------------"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "Show me costs by region for the last 30 days" \
  --session-id "curl-example-3" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

# Example 4: Optimization recommendations
echo "Example 4: Optimization opportunities"
echo "------------------------------------"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "What are my cost optimization opportunities?" \
  --session-id "curl-example-4" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

# Example 5: Cost forecast
echo "Example 5: Cost forecast"
echo "-----------------------"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "What will my costs be next month?" \
  --session-id "curl-example-5" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

# Example 6: Pricing comparison
echo "Example 6: Compare instance pricing"
echo "-----------------------------------"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "Compare pricing for t3.micro and t3.small" \
  --session-id "curl-example-6" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

# Example 7: Conversational context
echo "Example 7: Conversational follow-up"
echo "-----------------------------------"
SESSION_ID="curl-conversation"

echo "Q1: What are my top 5 services by cost?"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "What are my top 5 services by cost?" \
  --session-id "$SESSION_ID" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

echo "Q2: Tell me more about the second one"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "Tell me more about the second one" \
  --session-id "$SESSION_ID" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

echo "Q3: How can I optimize it?"
aws bedrock-agentcore invoke-agent-runtime \
  --runtime-arn "$RUNTIME_ARN" \
  --prompt "How can I optimize it?" \
  --session-id "$SESSION_ID" \
  --region "$AWS_REGION" \
  --output json | jq -r '.result'
echo ""

echo "All examples completed!"
