#!/usr/bin/env python3
"""
Example Python client for the FinOps Agent using AWS SDK
"""

import boto3
import json
import sys

# Configuration
RUNTIME_ARN = "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/finops_runtime-xxx"
AWS_REGION = "us-east-1"

def invoke_agent(prompt, session_id="example-session"):
    """
    Invoke the FinOps Agent with a prompt
    
    Args:
        prompt: The question to ask the agent
        session_id: Session ID for conversation context
    
    Returns:
        Agent response
    """
    client = boto3.client('bedrock-agentcore', region_name=AWS_REGION)
    
    try:
        response = client.invoke_agent_runtime(
            runtimeArn=RUNTIME_ARN,
            prompt=prompt,
            sessionId=session_id
        )
        
        # Extract result from response
        result = response.get('result', 'No response')
        return result
        
    except Exception as e:
        print(f"Error invoking agent: {e}")
        return None


def main():
    """Main function with example queries"""
    
    # Example 1: Simple cost query
    print("=" * 60)
    print("Example 1: What are my costs for last month?")
    print("=" * 60)
    response = invoke_agent("What are my AWS costs for last month?")
    print(response)
    print()
    
    # Example 2: Service breakdown
    print("=" * 60)
    print("Example 2: Top services by cost")
    print("=" * 60)
    response = invoke_agent("What are my top 10 services by cost?")
    print(response)
    print()
    
    # Example 3: Optimization recommendations
    print("=" * 60)
    print("Example 3: Optimization opportunities")
    print("=" * 60)
    response = invoke_agent("What are my cost optimization opportunities?")
    print(response)
    print()
    
    # Example 4: Conversational context
    print("=" * 60)
    print("Example 4: Conversational follow-up")
    print("=" * 60)
    session_id = "conversation-example"
    
    response1 = invoke_agent("What are my top 5 services by cost?", session_id)
    print("Q1:", response1)
    print()
    
    response2 = invoke_agent("Tell me more about the second one", session_id)
    print("Q2:", response2)
    print()
    
    response3 = invoke_agent("How can I optimize it?", session_id)
    print("Q3:", response3)
    print()
    
    # Example 5: Pricing comparison
    print("=" * 60)
    print("Example 5: Compare instance pricing")
    print("=" * 60)
    response = invoke_agent("Compare pricing for t3.micro and t3.small")
    print(response)
    print()


if __name__ == "__main__":
    # Check if custom prompt provided
    if len(sys.argv) > 1:
        custom_prompt = " ".join(sys.argv[1:])
        print(f"Custom Query: {custom_prompt}")
        print("=" * 60)
        response = invoke_agent(custom_prompt)
        print(response)
    else:
        # Run examples
        main()
