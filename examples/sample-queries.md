# Sample Queries

Example questions you can ask the FinOps Agent and expected responses.

## Cost Analysis

### Basic Cost Queries

**Query:** "What are my AWS costs for last month?"
**Expected:** Monthly cost breakdown with total spend

**Query:** "Show me my costs for the last 7 days"
**Expected:** Daily cost breakdown for the past week

**Query:** "What did I spend in January 2025?"
**Expected:** Total costs for January with daily/monthly breakdown

### Service-Level Analysis

**Query:** "What are my top 10 services by cost?"
**Expected:** List of top 10 services with costs

**Query:** "Show me costs by service for last month"
**Expected:** Complete service breakdown with costs

**Query:** "Which service costs the most?"
**Expected:** Top service with cost details

### Regional Analysis

**Query:** "Show me costs by region"
**Expected:** Regional cost breakdown

**Query:** "What are my costs in us-east-1?"
**Expected:** Costs specific to us-east-1 region

### Account Analysis

**Query:** "Break down costs by linked account"
**Expected:** Per-account cost breakdown

**Query:** "What are my costs by account for last month?"
**Expected:** Monthly costs grouped by linked account

## Cost Forecasting

**Query:** "What will my costs be next month?"
**Expected:** Cost forecast for next month

**Query:** "Project my costs for the next 3 months"
**Expected:** 3-month cost projection with monthly breakdown

**Query:** "Forecast my spending for Q2 2025"
**Expected:** Quarterly forecast

## Optimization

### Rightsizing

**Query:** "Show me underutilized EC2 instances"
**Expected:** List of EC2 instances with rightsizing recommendations

**Query:** "Get EC2 rightsizing recommendations"
**Expected:** Detailed rightsizing opportunities with potential savings

**Query:** "What instances can I downsize?"
**Expected:** Instances that can be downsized with recommendations

### Savings Plans

**Query:** "How much can I save with Savings Plans?"
**Expected:** Savings Plans recommendations with estimated savings

**Query:** "Show me Savings Plans opportunities"
**Expected:** Detailed Savings Plans purchase recommendations

### Compute Optimizer

**Query:** "Get compute optimizer recommendations"
**Expected:** Multi-resource optimization recommendations

**Query:** "Show me EBS optimization opportunities"
**Expected:** EBS volume optimization recommendations

**Query:** "Optimize my Lambda functions"
**Expected:** Lambda function optimization recommendations

## Budget Management

**Query:** "List my budgets"
**Expected:** All budgets with current status

**Query:** "Show me budget details for production"
**Expected:** Detailed information about production budget

**Query:** "What's the status of my dev budget?"
**Expected:** Current status and utilization of dev budget

## Anomaly Detection

**Query:** "Are there any cost anomalies?"
**Expected:** List of detected cost anomalies

**Query:** "Show me unusual spending patterns"
**Expected:** Anomalies with details and impact

**Query:** "Detect any cost spikes in the last week"
**Expected:** Recent cost anomalies

## Free Tier

**Query:** "Check my free tier usage"
**Expected:** Free tier usage status across services

**Query:** "Am I still in free tier?"
**Expected:** Free tier eligibility and usage

**Query:** "Show me free tier limits"
**Expected:** Free tier limits and current usage

## Pricing Information

### EC2 Pricing

**Query:** "What's the price of t3.micro?"
**Expected:** Hourly pricing for t3.micro instance

**Query:** "Get pricing for m5.large in us-west-2"
**Expected:** Regional pricing for m5.large

**Query:** "Compare pricing for t3.micro and t3.small"
**Expected:** Side-by-side pricing comparison

### RDS Pricing

**Query:** "What's the price of db.t3.micro MySQL?"
**Expected:** RDS pricing for MySQL instance

**Query:** "Get RDS pricing for PostgreSQL db.r5.large"
**Expected:** PostgreSQL RDS pricing

### Lambda Pricing

**Query:** "What's Lambda pricing in us-east-1?"
**Expected:** Lambda pricing details (requests, duration, etc.)

**Query:** "How much does Lambda cost?"
**Expected:** Lambda pricing breakdown

### Service Pricing

**Query:** "Get pricing for S3"
**Expected:** S3 storage and request pricing

**Query:** "What's DynamoDB pricing?"
**Expected:** DynamoDB pricing details

## Conversational Queries

### Follow-up Questions

**Query 1:** "What are my top 5 services by cost?"
**Response:** [Lists top 5 services]

**Query 2:** "Tell me more about the second one"
**Response:** [Details about the second service]

**Query 3:** "How can I optimize it?"
**Response:** [Optimization recommendations for that service]

### Complex Multi-Tool Queries

**Query:** "What are my costs and optimization opportunities?"
**Expected:** Combined response using multiple tools:
- Current costs
- Rightsizing recommendations
- Savings Plans opportunities
- Compute Optimizer recommendations

**Query:** "Analyze my AWS spending and suggest improvements"
**Expected:** Comprehensive analysis with:
- Cost breakdown
- Trends
- Anomalies
- Optimization recommendations

## Usage Type Analysis

**Query:** "Show me costs by usage type"
**Expected:** Breakdown by usage types (BoxUsage, DataTransfer, etc.)

**Query:** "What usage types cost the most?"
**Expected:** Top usage types with costs

## Instance Type Analysis

**Query:** "Show me costs by instance type"
**Expected:** Breakdown by EC2 instance types

**Query:** "What instance types am I using?"
**Expected:** List of instance types with costs

## Tips for Effective Queries

### Be Specific with Dates
- ✅ "Show me costs for January 2025"
- ❌ "Show me costs for last month" (ambiguous if run at month start)

### Use Natural Language
- ✅ "What did I spend on EC2 last week?"
- ✅ "How much did EC2 cost last week?"
- Both work equally well

### Ask Follow-up Questions
- The agent remembers context
- You can refer to previous responses
- Build on earlier questions

### Combine Multiple Aspects
- "Show me costs by service and region"
- "What are my costs and savings opportunities?"
- Agent will use multiple tools as needed

## Expected Response Times

- Simple queries (single tool): 2-3 seconds
- Complex queries (multiple tools): 5-10 seconds
- Pricing comparisons: 3-5 seconds
- Optimization recommendations: 5-8 seconds
