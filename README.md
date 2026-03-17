# FinOps Agent with Amazon Bedrock AgentCore and MCP Servers

A FinOps AI agent that uses AWS Labs MCP servers (Billing and Pricing) deployed as AgentCore Runtimes, unified behind an AgentCore Gateway, and powered by Claude Sonnet 3.7.

## Architecture

```
┌──────────────┐     Cognito      ┌───────────────────┐      IAM       ┌─────────────────┐
│   Frontend   │────(Identity)───▶│   Main Runtime    │───(SigV4)────▶│    Gateway      │
│   (Amplify)  │                  │  (finops_runtime) │               │ (finops-gateway) │
└──────────────┘                  │                   │               │   AWS_IAM auth   │
                                  │  Claude 3.7       │               └────────┬─────────┘
                                  │  + Memory         │                        │
                                  └───────────────────┘                        │ OAuth
                                                                    (AuthStack Cognito M2M)
                                                                               │
                                                          ┌───────────────────┬┴───────────────────┐
                                                          │                                        │
                                                          ▼                                        ▼
                                                ┌──────────────────┐                    ┌──────────────────┐
                                                │  Billing MCP     │                    │  Pricing MCP     │
                                                │  Runtime         │                    │  Runtime         │
                                                │  (JWT auth)      │                    │  (JWT auth)      │
                                                │                  │                    │                  │
                                                │  streamable-http │                    │  streamable-http │
                                                │  on port 8000    │                    │  on port 8000    │
                                                └────────┬─────────┘                    └────────┬─────────┘
                                                         │                                       │
                                                         ▼                                       ▼
                                                ┌──────────────────┐                    ┌──────────────────┐
                                                │  AWS Cost        │                    │  AWS Pricing     │
                                                │  Explorer API    │                    │  API             │
                                                │  Budgets API     │                    │                  │
                                                │  Compute Opt.    │                    │                  │
                                                │  Free Tier API   │                    │                  │
                                                └──────────────────┘                    └──────────────────┘
```

## Communication Flow

1. **Frontend → Main Runtime**: User authenticates via Cognito Identity Pool. The authenticated role grants `InvokeAgentRuntime` on the main runtime. Frontend calls the runtime endpoint with Cognito credentials.

2. **Main Runtime → Gateway**: The agent code uses `InvokeGateway` API with IAM SigV4 signing (runtime's execution role credentials). Gateway uses `AWS_IAM` authorizer — no JWT needed for this hop.

3. **Gateway → MCP Runtimes**: Gateway obtains an OAuth token from AgentCore Identity using the OAuth credential provider (configured with AuthStack's Cognito M2M client). The token is sent as a JWT Bearer to the MCP runtimes. Each runtime validates the JWT against AuthStack's Cognito discovery URL.

4. **MCP Runtimes → AWS APIs**: Each runtime's execution role has specific IAM permissions for the AWS APIs it needs (Cost Explorer, Budgets, Pricing, etc.).

## Deployment Sequence

All 5 stacks deploy with a single command. CDK handles ordering via dependencies.

```bash
export ADMIN_EMAIL="your-email@example.com"
cd cdk && npm install && npm run build && npx cdk bootstrap && npx cdk deploy --all --require-approval never
```

After deployment, use the following outputs from `FinOpsAgentRuntimeStack` to configure your frontend application:
- `FrontendUserPoolId` — Cognito User Pool ID
- `FrontendUserPoolClientId` — Cognito User Pool Client ID
- `FrontendIdentityPoolId` — Cognito Identity Pool ID
- `FrontendRuntimeArn` — Main Agent Runtime ARN

### Stack 1: FinOpsAuthStack

Cognito authentication for the entire solution.

| Resource | Purpose |
|----------|---------|
| Cognito User Pool | User authentication |
| Resource Server (`mcp-runtime-server/invoke`) | OAuth scope for M2M flow |
| User Client | Frontend user authentication (no secret) |
| M2M Client | Gateway → Runtime OAuth flow (with secret, client_credentials) |
| Identity Pool | Maps Cognito users to IAM roles |
| Authenticated Role | `InvokeAgentRuntime` on `finops_billing_mcp*`, `finops_pricing_mcp*`, `finops_runtime*` |
| Secrets Manager Secret | Stores M2M client credentials |

### Stack 2: FinOpsImageStack

Builds Docker images for all runtimes using CodeBuild.

| Resource | Purpose |
|----------|---------|
| 3 ECR Repositories | `finops-agent-runtime`, `finops-billing-mcp-runtime`, `finops-pricing-mcp-runtime` |
| S3 Bucket | Stores CodeBuild source scripts |
| 3 CodeBuild Projects | Builds ARM64 Docker images |
| Build Trigger Lambda | Starts CodeBuild on stack deploy |
| Build Waiter Lambda | Polls build status until complete |

For billing and pricing MCP servers, CodeBuild:
1. Clones the upstream [AWS Labs MCP repo](https://github.com/awslabs/mcp)
2. Patches `server.py` to use `streamable-http` transport on port 8000
3. Updates Dockerfile (EXPOSE 8000, entrypoint, healthcheck)
4. Builds ARM64 image and pushes to ECR

### Stack 3: FinOpsMCPRuntimeStack

Two AgentCore Runtimes running the patched AWS Labs MCP servers.

| Resource | Purpose |
|----------|---------|
| Billing MCP Runtime (`finops_billing_mcp_jwt_v1`) | Runs billing MCP server with JWT auth |
| Pricing MCP Runtime (`finops_pricing_mcp_jwt_v1`) | Runs pricing MCP server with JWT auth |
| Billing Runtime Role | ECR pull, CloudWatch Logs, Cost Explorer/Budgets/Compute Optimizer APIs |
| Pricing Runtime Role | ECR pull, CloudWatch Logs, Pricing API |

JWT Authorization: `AllowedClients` = AuthStack M2M client ID, `DiscoveryUrl` = AuthStack Cognito.

### Stack 4: FinOpsAgentCoreGatewayStack

AgentCore Gateway that unifies both MCP servers behind a single endpoint.

| Resource | Purpose |
|----------|---------|
| Gateway (`finops-gateway`) | MCP protocol, `AWS_IAM` auth |
| OAuth Provider (Lambda custom resource) | Creates AgentCore Identity credential provider using AuthStack's Cognito |
| Gateway Token Exchange Policy | `GetWorkloadAccessToken`, `GetResourceOauth2Token` (wildcard) |
| Gateway Default Policy | Scoped access to OAuth provider ARN and auto-created secret |
| Billing MCP Target (`billingMcp`) | Points to billing runtime endpoint |
| Pricing MCP Target (`pricingMcp`) | Points to pricing runtime endpoint |

### Stack 5: FinOpsAgentRuntimeStack

The main agent runtime that users interact with.

| Resource | Purpose |
|----------|---------|
| Runtime (`finops_runtime`) | Runs agent code with Claude 3.7 |
| Memory (`finops_memory`) | 30-day conversation memory |
| Runtime Role | ECR pull, CloudWatch Logs, Bedrock model invocation, Memory access, Gateway invocation |

Environment variables: `MODEL_ID`, `GATEWAY_ARN`, `MEMORY_ID`, `AWS_REGION`.

## Project Structure

```
├── agentcore/                    # Main agent runtime code
│   ├── agent_runtime.py          # Agent logic (Strands + Gateway MCP tools)
│   ├── streamable_http_sigv4.py  # SigV4 auth for Gateway HTTP calls
│   ├── Dockerfile                # Multi-stage build for agent container
│   └── requirements.txt          # Python dependencies
├── codebuild-scripts/            # stdio-to-HTTP transformation scripts
│   ├── buildspec-billing.yml     # CodeBuild spec for billing MCP
│   ├── buildspec-pricing.yml     # CodeBuild spec for pricing MCP
│   ├── transform-billing.sh      # Patches billing server for HTTP transport
│   └── transform-pricing.sh      # Patches pricing server for HTTP transport
├── cdk/                          # CDK infrastructure
│   ├── bin/app.ts                # Stack wiring and deployment sequence
│   ├── lib/
│   │   ├── auth-stack.ts         # Cognito + Identity Pool
│   │   ├── image-stack.ts        # ECR + CodeBuild
│   │   ├── mcp-runtime-stack.ts  # MCP server runtimes
│   │   ├── gateway-stack.ts      # Gateway + OAuth + targets
│   │   └── agent-runtime-stack.ts # Main agent runtime + memory
│   ├── package.json
│   ├── tsconfig.json
│   └── cdk.json
├── lambda/                       # CloudFormation custom resource Lambdas
│   ├── build-trigger/index.py    # Triggers CodeBuild
│   └── build-waiter/index.py     # Polls build status
└── amplify-frontend/             # React frontend (pre-built)
    └── AWS-Amplify-Frontend.zip
```

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ and npm
- CDK CLI (`npm install -g aws-cdk`)
- Claude Sonnet 3.7 model access enabled in Amazon Bedrock (us-east-1)

## Key Design Decisions

- **Claude Sonnet 3.7** over Nova Pro: Nova has issues with hyphens in MCP tool names. Claude handles them correctly.
- **AWS_IAM** Gateway auth: Main Runtime calls Gateway via `InvokeGateway` API (IAM). No need for JWT on this hop.
- **Separate Cognito for OAuth**: AuthStack's Cognito is shared between MCP runtime JWT auth and Gateway's OAuth provider. Same issuer = tokens are trusted.
- **stdio-to-HTTP transform**: AWS Labs MCP servers only support stdio. CodeBuild patches them at build time to use `streamable-http` transport via `mcp.run(transport='streamable-http')`.
- **Least privilege IAM**: No `BedrockAgentCoreFullAccess`. Each role has only the specific permissions it needs.

## Cleanup

```bash
cd cdk && npx cdk destroy --all
```

## Troubleshooting Guide: Errors and Solutions

Issues encountered during development and their fixes, documented for reference.

### 1. X-Ray Propagator Not Found

**Error**: `ValueError: Propagator xray not found` in MCP runtime logs.

**Cause**: AWS Labs MCP servers use OpenTelemetry with X-Ray propagator, which isn't installed in the container.

**Fix**: Set environment variable `OTEL_PROPAGATORS=tracecontext,baggage` to use standard propagators instead of X-Ray.

---

### 2. Gateway Target Validation Timeout

**Error**: `Gateway target update failed or timed out: Polling timeout or max attempts reached: UPDATING`

**Cause**: AWS Labs MCP servers run with stdio transport by default. The Gateway needs HTTP endpoints to validate targets during `CreateGatewayTarget`.

**Fix**: Transform the MCP servers at build time to use `streamable-http` transport. CodeBuild patches `server.py` to call `mcp.run(transport='streamable-http', host='0.0.0.0', port=8000)`.

---

### 3. Gateway Role Missing Token Exchange Permissions

**Error**: Gateway could not negotiate OAuth tokens with AgentCore Identity to authenticate outbound requests to MCP runtimes.

**Cause**: Gateway role was missing `bedrock-agentcore:GetWorkloadAccessToken` and `bedrock-agentcore:GetResourceOauth2Token`.

**Fix**: Two policies on the Gateway role:
- **Scoped policy**: `GetResourceOauth2Token`, `GetWorkloadAccessToken`, `secretsmanager:GetSecretValue`, `secretsmanager:DescribeSecret` on the OAuth provider's token-vault ARN and auto-created secret.
- **Wildcard policy**: `GetWorkloadAccessToken`, `GetResourceOauth2Token` on `*`.

---

### 4. OAuth Provider API Parameter Mismatch

**Error**: `Unknown parameter in input: "credentialProviderArn"` when creating OAuth provider via Lambda custom resource.

**Cause**: The `create_oauth2_credential_provider` API expects `clientId` and `clientSecret` inside `customOauth2ProviderConfig`, not at the top level. Also, the vendor must be `CustomOauth2` (not `CustomOAuth`), and discovery URL goes inside `oauthDiscovery.discoveryUrl`.

**Fix**: Correct API call structure:
```python
client.create_oauth2_credential_provider(
    name=provider_name,
    credentialProviderVendor='CustomOauth2',
    oauth2ProviderConfigInput={
        'customOauth2ProviderConfig': {
            'oauthDiscovery': { 'discoveryUrl': discovery_url },
            'clientId': client_id,
            'clientSecret': client_secret,
        },
    },
)
```

---

### 5. OAuth Provider Lambda Missing CreateTokenVault Permission

**Error**: `AccessDeniedException: not authorized to perform bedrock-agentcore:CreateTokenVault`

**Cause**: Creating an OAuth credential provider also creates a token vault. The Lambda role needed additional permissions.

**Fix**: Added to the Lambda role:
- `bedrock-agentcore:CreateTokenVault`, `bedrock-agentcore:GetTokenVault`
- `secretsmanager:CreateSecret`, `secretsmanager:DeleteSecret`, `secretsmanager:PutSecretValue`, `secretsmanager:TagResource` on `bedrock-agentcore-identity*`

---

### 6. OAuth Token Mismatch Between Gateway and Runtime

**Error**: `Error parsing ClientCredentials response (Status Code: 400)` when Gateway tries to add MCP targets.

**Cause**: Gateway's OAuth provider was using its own Cognito User Pool, but the MCP runtimes' JWT authorizer was configured to trust AuthStack's Cognito. Tokens from different issuers are rejected.

**Fix**: Gateway's OAuth provider must use the same Cognito (AuthStack) that the MCP runtimes trust. Both the runtime's `DiscoveryUrl` and the OAuth provider's `discoveryUrl` must point to the same Cognito User Pool.

---

### 7. OAuth Scope Mismatch

**Error**: `Error parsing ClientCredentials response` — Cognito returns 400 when requesting a scope that doesn't exist.

**Cause**: AuthStack's resource server was `finops-mcp-resource-server` with scopes `mcp.read`/`mcp.write`, but Gateway targets requested scope `mcp-runtime-server/invoke`.

**Fix**: Changed AuthStack's resource server to `mcp-runtime-server` with scope `invoke`, matching what the Gateway targets request.

---

### 8. `streamable_http_app` AttributeError

**Error**: `AttributeError: 'FastMCP' object has no attribute 'streamable_http_app'`

**Cause**: The billing MCP server uses `fastmcp` package (not `mcp.server.fastmcp`). The `fastmcp` package's `FastMCP` class doesn't have `streamable_http_app()` — that method exists only in the `mcp` SDK's `FastMCP`.

**Fix**: Instead of creating a Starlette ASGI app manually, use `mcp.run(transport='streamable-http', host='0.0.0.0', port=8000, stateless_http=True)` which `fastmcp` handles internally.

---

### 9. Shell Quoting in Transform Script

**Error**: `SyntaxError: invalid syntax` — `mcp.run(transport=streamable-http)` missing quotes.

**Cause**: Python string values inside a `python3 -c "..."` shell command lost their double quotes due to shell escaping.

**Fix**: Use single quotes inside the Python triple-quoted string: `mcp.run(transport='streamable-http', host='0.0.0.0', ...)`.

---

### 10. Missing `@app.entrypoint` Decorator

**Error**: `No entrypoint defined` — runtime returns 500 on every request.

**Cause**: The `@app.entrypoint` decorator on the `invoke()` function was accidentally removed during a code edit.

**Fix**: Ensure `@app.entrypoint` is always present above the `invoke()` function. This is what tells `BedrockAgentCoreApp` which function handles incoming requests.

---

### 11. Nova Model Fails with Hyphenated Tool Names

**Error**: `Response ended prematurely` — intermittent, only when the model tries to call tools with hyphens in their names (e.g., `cost-explorer`, `free-tier-usage`).

**Cause**: Amazon Nova models have issues with hyphens in tool names. Bedrock's `ConverseStream` API expects tool names matching `^[a-zA-Z][a-zA-Z0-9_]*$`. Nova enforces this strictly; Claude does not.

**Fix**: Switched from `us.amazon.nova-pro-v1:0` to `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. Claude handles hyphenated tool names correctly. Alternative fix: rename tools at the source in the transform scripts.
