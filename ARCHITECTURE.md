# Architecture Overview

## High-Level Architecture

The FinOps Agent solution uses Amazon Bedrock AgentCore to create a production-ready AI agent for AWS cost management and optimization.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web Application (React)                      │
│              Amazon Cognito Authentication                      │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS/IAM Auth
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Amazon Bedrock AgentCore Runtime (ECS)             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Strands Agent + Amazon Nova Pro                         │  │
│  │  - Conversational Memory (30-day retention)              │  │
│  │  - MCP Client (SigV4 Authentication)                     │  │
│  │  - Tool Orchestration                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ IAM/SigV4
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Amazon Bedrock AgentCore Gateway                   │
│                    (IAM Authentication)                         │
│              Routes to MCP Lambda Servers                       │
└─────────────┬───────────────────────────────────┬───────────────┘
              │                                   │
              ▼                                   ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│  Billing MCP Lambda     │         │  Pricing MCP Lambda     │
│  (11 Cost Tools)        │         │  (9 Pricing Tools)      │
└─────────────────────────┘         └─────────────────────────┘
              │                                   │
              ▼                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                         AWS Services                            │
│  Cost Explorer | Budgets | Compute Optimizer | Pricing API     │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. AgentCore Runtime
- Containerized Python agent running on Amazon ECS
- Uses Strands framework for agent logic
- Integrates with Amazon Nova Pro model
- Manages conversational memory automatically
- Handles tool orchestration through MCP Client

### 2. AgentCore Gateway
- Intelligent routing layer for tool invocations
- IAM-based authentication using SigV4
- Routes requests to appropriate Lambda MCP servers
- Manages tool schemas and validation

### 3. AgentCore Memory
- 30-day conversation retention
- Per-user, per-session storage
- Automatic context management
- Prevents token limit issues

### 4. MCP Lambda Servers
- **Billing Lambda**: 11 tools for cost analysis
- **Pricing Lambda**: 9 tools for pricing information
- Implements Model Context Protocol
- Direct integration with AWS APIs

### 5. Frontend Application
- React-based web interface
- Amazon Cognito authentication
- Real-time streaming responses
- Session management

## Data Flow

1. User authenticates via Amazon Cognito
2. Frontend sends query to AgentCore Runtime
3. Runtime processes with Strands Agent + Nova Pro
4. Agent calls tools through MCP Client
5. Gateway routes to appropriate Lambda
6. Lambda executes AWS API calls
7. Results flow back through Gateway to Runtime
8. Runtime formats response for user
9. Memory stores conversation context

## Security

- IAM-based authentication throughout
- SigV4 signing for Gateway communication
- Cognito for user management
- Least-privilege IAM roles
- No hardcoded credentials

## Scalability

- Runtime auto-scales on ECS
- Lambda functions scale automatically
- Gateway handles concurrent requests
- Memory service is fully managed

## Tools Available

### Billing Tools (11)
- Cost analysis and reporting
- Budget management
- Optimization recommendations
- Free tier tracking
- Anomaly detection
- Cost forecasting

### Pricing Tools (9)
- Service pricing lookup
- Instance price comparisons
- Rate card information
- Multi-service pricing

For detailed tool documentation, see [docs/TOOL-REFERENCE.md](docs/TOOL-REFERENCE.md)
