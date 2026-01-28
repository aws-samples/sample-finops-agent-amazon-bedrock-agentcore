# Tool Reference

Complete reference for all 20 tools available in the FinOps Agent.

## Billing Tools (11 tools)

### Cost Analysis

#### 1. get_cost_and_usage
**Purpose:** Get historical AWS costs with flexible grouping

**Parameters:**
- `start_date` (required): Start date in YYYY-MM-DD format
- `end_date` (required): End date in YYYY-MM-DD format
- `granularity` (optional): DAILY or MONTHLY
- `group_by_dimension` (optional): Dimension to group by (REGION, LINKED_ACCOUNT, INSTANCE_TYPE, etc.)

**Example Questions:**
- "What are my costs for last month?"
- "Show me costs by region for the last 30 days"
- "Break down costs by linked account"

#### 2. get_cost_by_service
**Purpose:** Get costs grouped by AWS service

**Parameters:**
- `start_date` (required): Start date
- `end_date` (required): End date
- `granularity` (optional): DAILY or MONTHLY
- `group_by_service` (required): Always true

**Example Questions:**
- "What are my top 10 services by cost?"
- "Show me costs by service"
- "Which services cost the most?"

#### 3. get_cost_by_usage_type
**Purpose:** Get costs grouped by usage type

**Parameters:**
- `start_date` (required): Start date
- `end_date` (required): End date
- `granularity` (optional): DAILY or MONTHLY
- `group_by_usage_type` (required): Always true

**Example Questions:**
- "What are my costs by usage type?"
- "Show me usage type breakdown"

#### 4. get_cost_forecast
**Purpose:** Predict future costs

**Parameters:**
- `start_date` (required): Forecast start date
- `end_date` (required): Forecast end date
- `metric` (required): UNBLENDED_COST or BLENDED_COST

**Example Questions:**
- "What will my costs be next month?"
- "Forecast my spending for Q2"
- "Project my costs for the next 3 months"

#### 5. get_cost_anomalies
**Purpose:** Detect unusual spending patterns

**Parameters:**
- `start_date` (required): Start date
- `end_date` (required): End date
- `detect_anomalies` (required): Always true

**Example Questions:**
- "Are there any cost anomalies?"
- "Show me unusual spending"
- "Detect any cost spikes"

### Budget Management

#### 6. get_budgets
**Purpose:** List all AWS budgets

**Parameters:**
- `list_budgets` (required): Always true

**Example Questions:**
- "List my budgets"
- "Show me all budgets"
- "What budgets do I have?"

#### 7. get_budget_details
**Purpose:** Get detailed budget information

**Parameters:**
- `budget_name` (required): Name of the budget

**Example Questions:**
- "Show me details for production budget"
- "What's the status of my dev budget?"

### Optimization

#### 8. get_free_tier_usage
**Purpose:** Check AWS Free Tier usage

**Parameters:**
- `check_free_tier` (required): Always true

**Example Questions:**
- "Check my free tier usage"
- "Am I still in free tier?"
- "Show me free tier status"

#### 9. get_rightsizing_recommendations
**Purpose:** Get EC2 rightsizing opportunities

**Parameters:**
- `get_rightsizing` (required): Always true

**Example Questions:**
- "Get EC2 rightsizing recommendations"
- "Show me underutilized instances"
- "What instances can I downsize?"

#### 10. get_savings_plans_recommendations
**Purpose:** Get Savings Plans purchase advice

**Parameters:**
- `get_savings_plans` (required): Always true

**Example Questions:**
- "Show me Savings Plans recommendations"
- "How much can I save with Savings Plans?"
- "What Savings Plans should I buy?"

#### 11. get_compute_optimizer_recommendations
**Purpose:** Get multi-resource optimization recommendations

**Parameters:**
- `resource_type` (required): EC2Instance, EBSVolume, or Lambda

**Example Questions:**
- "Get compute optimizer recommendations"
- "Show me EBS optimization opportunities"
- "Optimize my Lambda functions"

## Pricing Tools (9 tools)

### Service Discovery

#### 1. get_service_codes
**Purpose:** List available AWS services

**Parameters:** None

**Example Questions:**
- "List AWS service codes"
- "What services can I get pricing for?"

#### 2. get_service_attributes
**Purpose:** Get pricing attributes for a service

**Parameters:**
- `service_code` (required): AWS service code (e.g., AmazonEC2)
- `get_attributes` (required): Always true

**Example Questions:**
- "What pricing attributes are available for EC2?"
- "Show me RDS pricing attributes"

#### 3. get_attribute_values
**Purpose:** Get possible values for an attribute

**Parameters:**
- `service_code` (required): AWS service code
- `attribute_name` (required): Attribute name

**Example Questions:**
- "Get attribute values for EC2 instance types"
- "What regions are available for RDS?"

### Pricing Lookup

#### 4. get_service_pricing
**Purpose:** Get generic service pricing

**Parameters:**
- `service_code` (required): AWS service code
- `region` (optional): AWS region
- `filters` (optional): Additional filters

**Example Questions:**
- "Get pricing for S3"
- "Show me DynamoDB pricing"

#### 5. get_ec2_pricing
**Purpose:** Get EC2 instance pricing

**Parameters:**
- `instance_type` (required): EC2 instance type
- `region` (optional): AWS region
- `operating_system` (optional): OS (Linux, Windows, etc.)

**Example Questions:**
- "What's the price of t3.micro?"
- "Get pricing for m5.large in us-west-2"

#### 6. get_rds_pricing
**Purpose:** Get RDS instance pricing

**Parameters:**
- `instance_type` (required): RDS instance type
- `engine` (required): Database engine (MySQL, PostgreSQL, etc.)
- `region` (optional): AWS region

**Example Questions:**
- "What's the price of db.t3.micro MySQL?"
- "Get RDS pricing for PostgreSQL db.r5.large"

#### 7. get_lambda_pricing
**Purpose:** Get Lambda pricing

**Parameters:**
- `region` (optional): AWS region
- `get_lambda_pricing` (required): Always true

**Example Questions:**
- "What's Lambda pricing?"
- "Get Lambda pricing for us-east-1"

#### 8. compare_instance_pricing
**Purpose:** Compare multiple EC2 instance types

**Parameters:**
- `instance_types` (required): Array of instance types
- `region` (optional): AWS region

**Example Questions:**
- "Compare pricing for t3.micro and t3.small"
- "Compare m5.large, m5.xlarge, and m5.2xlarge"

## Tool Usage Tips

### Conversational Context
The agent remembers previous questions, so you can ask follow-up questions:

```
User: "What are my top 5 services by cost?"
Agent: [Shows top 5 services]

User: "What about the second one?"
Agent: [Provides details about the second service]

User: "How can I optimize it?"
Agent: [Provides optimization recommendations]
```

### Combining Tools
The agent can use multiple tools to answer complex questions:

```
User: "What are my costs and optimization opportunities?"
Agent: [Uses get_cost_and_usage + get_rightsizing_recommendations + get_savings_plans_recommendations]
```

### Natural Language
Ask questions naturally - the agent understands intent:

- "How much did I spend last month?" → get_cost_and_usage
- "What's costing me the most?" → get_cost_by_service
- "Can I save money?" → get_rightsizing_recommendations + get_savings_plans_recommendations
