# Troubleshooting Guide

Common issues and solutions for the FinOps Agent.

## Deployment Issues

### CDK Bootstrap Required

**Error:** `This stack uses assets, so the toolkit stack must be deployed to the environment`

**Solution:**
```bash
cdk bootstrap aws://ACCOUNT-ID/us-east-1
```

### CodeBuild Fails

**Error:** Container build fails in ImageStack

**Solution:**
1. Check CloudWatch logs for the CodeBuild project
2. Verify ECR permissions
3. Ensure Docker base image is accessible
4. Check Python dependencies in requirements.txt

### Stack Deployment Timeout

**Error:** Stack deployment times out

**Solution:**
1. Check CloudFormation events for specific resource failures
2. Verify IAM permissions
3. Ensure service quotas are not exceeded
4. Try deploying stacks individually:
   ```bash
   cdk deploy ImageStack
   cdk deploy AgentStack
   cdk deploy AuthStack
   ```

## Runtime Issues

### Gateway ARN Not Configured

**Error:** `Gateway ARN not configured!`

**Solution:**
1. Verify AgentStack deployed successfully
2. Check Runtime environment variables in ECS task definition
3. Redeploy AgentStack if needed

### Tools Not Working

**Error:** Agent says tools are unavailable

**Solution:**
1. Check Gateway configuration in AgentStack
2. Verify Lambda functions have correct permissions
3. Check Gateway invocation logs in CloudWatch
4. Verify IAM role for Runtime has Gateway invoke permissions

### Memory Integration Issues

**Error:** Token limit exceeded or memory not working

**Solution:**
1. Verify Memory ID is set in Runtime environment variables
2. Check that AgentCoreMemorySessionManager is being used
3. Ensure session_id is consistent across requests
4. Verify IAM permissions for Memory service

## Authentication Issues

### Cannot Log In

**Error:** Invalid credentials or user not found

**Solution:**
1. Check email for temporary password
2. Verify User Pool ID is correct in frontend config
3. Check Cognito User Pool in AWS console
4. Reset password if needed:
   ```bash
   aws cognito-idp admin-set-user-password \
     --user-pool-id <USER_POOL_ID> \
     --username admin \
     --password <NEW_PASSWORD> \
     --permanent
   ```

### Frontend Cannot Connect to Runtime

**Error:** 403 Forbidden or authentication errors

**Solution:**
1. Verify Identity Pool configuration
2. Check IAM role for authenticated users
3. Ensure Runtime ARN is in the IAM policy
4. Verify Cognito credentials are being exchanged correctly

## Tool-Specific Issues

### Cost Explorer Returns No Data

**Error:** No cost data returned

**Solution:**
1. Verify Cost Explorer is enabled in your account
2. Check date range (must be within available data)
3. Ensure IAM role has Cost Explorer permissions
4. Wait 24 hours after enabling Cost Explorer

### Compute Optimizer Not Enabled

**Error:** `Compute Optimizer is not enabled`

**Solution:**
1. Navigate to Compute Optimizer console
2. Opt-in to the service
3. Wait 30 hours for initial analysis
4. Ensure IAM role has Compute Optimizer permissions

### Rightsizing Recommendations Not Available

**Error:** No rightsizing recommendations found

**Solution:**
1. Enable rightsizing recommendations in Cost Explorer Preferences
2. Wait 14 days for sufficient data collection
3. Verify you have EC2 instances running
4. Check IAM permissions for Cost Explorer

### Pricing API Errors

**Error:** Pricing data not available

**Solution:**
1. Verify Pricing API is called from us-east-1
2. Check IAM permissions for Pricing API
3. Verify service code is correct
4. Check rate limits (Pricing API has throttling)

## Performance Issues

### Slow Response Times

**Issue:** Agent takes too long to respond

**Solution:**
1. Check CloudWatch metrics for Runtime
2. Verify Lambda function timeout settings (should be 300s)
3. Check if multiple tools are being called
4. Consider increasing Runtime task size

### High Costs

**Issue:** Solution costs more than expected

**Solution:**
1. Check Runtime task count (should scale down when idle)
2. Review Lambda invocation counts
3. Check Memory storage usage
4. Consider using Savings Plans for predictable workloads

## Frontend Issues

### Configuration Not Saving

**Issue:** Frontend loses configuration

**Solution:**
1. Configuration is stored in browser localStorage
2. Clear browser cache and re-enter configuration
3. Verify all required fields are filled
4. Check browser console for errors

### Streaming Not Working

**Issue:** Responses don't stream, appear all at once

**Solution:**
1. Check browser compatibility (modern browsers required)
2. Verify Runtime is returning streaming responses
3. Check network tab for SSE/streaming connection
4. Try different browser

## Debugging Tips

### Enable Detailed Logging

Add to Runtime environment variables:
```
LOG_LEVEL=DEBUG
```

### Check CloudWatch Logs

```bash
# Runtime logs
aws logs tail /aws/bedrock-agentcore/runtime/finops-runtime --follow

# Billing Lambda
aws logs tail /aws/lambda/FinOpsAgentStack-billing-mcp --follow

# Pricing Lambda
aws logs tail /aws/lambda/FinOpsAgentStack-pricing-mcp --follow
```

### Test Individual Components

Test Lambda functions directly:
```bash
aws lambda invoke \
  --function-name FinOpsAgentStack-billing-mcp \
  --payload '{"start_date":"2025-01-01","end_date":"2025-01-31","group_by_service":true}' \
  response.json
```

### Verify Gateway Connectivity

Test Gateway from Runtime:
```python
# In Runtime container
curl -X POST https://<gateway-id>.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp \
  --aws-sigv4 "aws:amz:us-east-1:bedrock-agentcore"
```

## Getting Help

If you continue to experience issues:

1. Check [GitHub Issues](https://github.com/your-repo/issues)
2. Review [AWS Bedrock AgentCore Documentation](https://docs.aws.amazon.com/bedrock-agentcore/)
3. Check [AWS Support](https://console.aws.amazon.com/support/)
4. Review CloudWatch logs for detailed error messages

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `validationException: Input Tokens Exceeded` | Manual memory injection | Use AgentCoreMemorySessionManager |
| `401 Unauthorized` | Gateway authentication | Switch to IAM authentication |
| `Tool not found` | Tool signature conflict | Ensure unique tool signatures |
| `AccessDenied` | IAM permissions | Add required permissions to role |
| `ResourceNotFoundException` | Resource doesn't exist | Verify resource ARN and region |
