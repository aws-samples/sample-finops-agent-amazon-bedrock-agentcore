#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const image_stack_1 = require("../lib/image-stack");
const auth_stack_1 = require("../lib/auth-stack");
const mcp_runtime_stack_1 = require("../lib/mcp-runtime-stack");
const gateway_stack_1 = require("../lib/gateway-stack");
const agent_runtime_stack_1 = require("../lib/agent-runtime-stack");
const app = new cdk.App();
// Add CDK-Nag AWS Solutions checks
aws_cdk_lib_1.Aspects.of(app).add(new cdk_nag_1.AwsSolutionsChecks({ verbose: true }));
// Get configuration from context or environment
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};
const adminEmail = process.env.ADMIN_EMAIL || app.node.tryGetContext('adminEmail');
if (!adminEmail) {
    console.error('\n❌ ERROR: ADMIN_EMAIL environment variable is required.');
    console.error('Please set it before deploying:');
    console.error('  export ADMIN_EMAIL="your-email@example.com"');
    console.error('  cdk deploy\n');
    throw new Error('ADMIN_EMAIL environment variable is required. Set it before deploying.');
}
// ========================================
// Validated Deployment Sequence
// ========================================
// Stack 1: Image Stack - Builds Docker images for Agent Runtimes
const imageStack = new image_stack_1.ImageStack(app, 'FinOpsImageStack', {
    env,
    description: 'FinOps Agent - Docker Image Build (ECR + CodeBuild)',
});
// Stack 2: Auth Stack - Cognito + M2M + OAuth Provider (Custom Resource)
const authStack = new auth_stack_1.AuthStack(app, 'FinOpsAuthStack', {
    env,
    description: 'FinOps Agent - Cognito Authentication + OAuth Provider',
    adminEmail: adminEmail,
});
// Stack 3: MCP Runtime Stack - Deploy 2 MCP Runtimes with JWT auth
const mcpRuntimeStack = new mcp_runtime_stack_1.MCPRuntimeStack(app, 'FinOpsMCPRuntimeStack', {
    env,
    description: 'FinOps Agent - MCP Server Runtimes (Billing + Pricing) with JWT Authorization',
    billingMcpRepository: imageStack.billingMcpRepository,
    pricingMcpRepository: imageStack.pricingMcpRepository,
    userPoolId: authStack.userPoolId,
    m2mClientId: authStack.oauthClientId,
});
mcpRuntimeStack.addDependency(imageStack);
mcpRuntimeStack.addDependency(authStack);
// Stack 4: AgentCore Gateway Stack - Gateway + its own Cognito + OAuth provider + MCP targets
const agentCoreGatewayStack = new gateway_stack_1.AgentCoreGatewayStack(app, 'FinOpsAgentCoreGatewayStack', {
    env,
    description: 'FinOps Agent - Gateway with MCP Server Targets',
    billingMcpRuntimeArn: mcpRuntimeStack.billingMcpRuntimeArn,
    pricingMcpRuntimeArn: mcpRuntimeStack.pricingMcpRuntimeArn,
    billingMcpRuntimeEndpoint: mcpRuntimeStack.billingMcpRuntimeEndpoint,
    pricingMcpRuntimeEndpoint: mcpRuntimeStack.pricingMcpRuntimeEndpoint,
    // AuthStack Cognito for outbound OAuth to runtimes
    authUserPoolId: authStack.userPoolId,
    authUserPoolArn: authStack.userPoolArn,
    authM2mClientId: authStack.oauthClientId,
});
agentCoreGatewayStack.addDependency(mcpRuntimeStack);
agentCoreGatewayStack.addDependency(authStack);
// Stack 5: Main Runtime Stack - Main agent runtime with Gateway ARN
const agentRuntimeStack = new agent_runtime_stack_1.AgentRuntimeStack(app, 'FinOpsAgentRuntimeStack', {
    env,
    description: 'FinOps Agent - Main Agent Runtime with Gateway Integration',
    repository: imageStack.repository,
    userPoolArn: authStack.userPoolArn,
    gatewayArn: agentCoreGatewayStack.gatewayArn,
    userPoolId: authStack.userPoolId,
    userPoolClientId: authStack.userPoolClientId,
    identityPoolId: authStack.identityPoolId,
});
agentRuntimeStack.addDependency(imageStack);
agentRuntimeStack.addDependency(authStack);
agentRuntimeStack.addDependency(agentCoreGatewayStack);
// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'FinOpsAgent');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLHVDQUFxQztBQUNyQyxpREFBbUM7QUFDbkMsNkNBQXNDO0FBQ3RDLHFDQUE2QztBQUM3QyxvREFBZ0Q7QUFDaEQsa0RBQThDO0FBQzlDLGdFQUEyRDtBQUMzRCx3REFBNkQ7QUFDN0Qsb0VBQStEO0FBRS9ELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLG1DQUFtQztBQUNuQyxxQkFBTyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSw0QkFBa0IsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFFL0QsZ0RBQWdEO0FBQ2hELE1BQU0sR0FBRyxHQUFHO0lBQ1YsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO0lBQ3hDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLFdBQVc7Q0FDdEQsQ0FBQztBQUVGLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRW5GLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUNoQixPQUFPLENBQUMsS0FBSyxDQUFDLDBEQUEwRCxDQUFDLENBQUM7SUFDMUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0lBQ2pELE9BQU8sQ0FBQyxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQztJQUMvRCxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7SUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQyx3RUFBd0UsQ0FBQyxDQUFDO0FBQzVGLENBQUM7QUFFRCwyQ0FBMkM7QUFDM0MsZ0NBQWdDO0FBQ2hDLDJDQUEyQztBQUUzQyxpRUFBaUU7QUFDakUsTUFBTSxVQUFVLEdBQUcsSUFBSSx3QkFBVSxDQUFDLEdBQUcsRUFBRSxrQkFBa0IsRUFBRTtJQUN6RCxHQUFHO0lBQ0gsV0FBVyxFQUFFLHFEQUFxRDtDQUNuRSxDQUFDLENBQUM7QUFFSCx5RUFBeUU7QUFDekUsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEdBQUcsRUFBRSxpQkFBaUIsRUFBRTtJQUN0RCxHQUFHO0lBQ0gsV0FBVyxFQUFFLHdEQUF3RDtJQUNyRSxVQUFVLEVBQUUsVUFBVTtDQUN2QixDQUFDLENBQUM7QUFFSCxtRUFBbUU7QUFDbkUsTUFBTSxlQUFlLEdBQUcsSUFBSSxtQ0FBZSxDQUFDLEdBQUcsRUFBRSx1QkFBdUIsRUFBRTtJQUN4RSxHQUFHO0lBQ0gsV0FBVyxFQUFFLCtFQUErRTtJQUM1RixvQkFBb0IsRUFBRSxVQUFVLENBQUMsb0JBQW9CO0lBQ3JELG9CQUFvQixFQUFFLFVBQVUsQ0FBQyxvQkFBb0I7SUFDckQsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVO0lBQ2hDLFdBQVcsRUFBRSxTQUFTLENBQUMsYUFBYTtDQUNyQyxDQUFDLENBQUM7QUFDSCxlQUFlLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQzFDLGVBQWUsQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUM7QUFFekMsOEZBQThGO0FBQzlGLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxxQ0FBcUIsQ0FBQyxHQUFHLEVBQUUsNkJBQTZCLEVBQUU7SUFDMUYsR0FBRztJQUNILFdBQVcsRUFBRSxnREFBZ0Q7SUFDN0Qsb0JBQW9CLEVBQUUsZUFBZSxDQUFDLG9CQUFvQjtJQUMxRCxvQkFBb0IsRUFBRSxlQUFlLENBQUMsb0JBQW9CO0lBQzFELHlCQUF5QixFQUFFLGVBQWUsQ0FBQyx5QkFBeUI7SUFDcEUseUJBQXlCLEVBQUUsZUFBZSxDQUFDLHlCQUF5QjtJQUNwRSxtREFBbUQ7SUFDbkQsY0FBYyxFQUFFLFNBQVMsQ0FBQyxVQUFVO0lBQ3BDLGVBQWUsRUFBRSxTQUFTLENBQUMsV0FBVztJQUN0QyxlQUFlLEVBQUUsU0FBUyxDQUFDLGFBQWE7Q0FDekMsQ0FBQyxDQUFDO0FBQ0gscUJBQXFCLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxDQUFDO0FBQ3JELHFCQUFxQixDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUUvQyxvRUFBb0U7QUFDcEUsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLHVDQUFpQixDQUFDLEdBQUcsRUFBRSx5QkFBeUIsRUFBRTtJQUM5RSxHQUFHO0lBQ0gsV0FBVyxFQUFFLDREQUE0RDtJQUN6RSxVQUFVLEVBQUUsVUFBVSxDQUFDLFVBQVU7SUFDakMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxXQUFXO0lBQ2xDLFVBQVUsRUFBRSxxQkFBcUIsQ0FBQyxVQUFVO0lBQzVDLFVBQVUsRUFBRSxTQUFTLENBQUMsVUFBVTtJQUNoQyxnQkFBZ0IsRUFBRSxTQUFTLENBQUMsZ0JBQWdCO0lBQzVDLGNBQWMsRUFBRSxTQUFTLENBQUMsY0FBYztDQUN6QyxDQUFDLENBQUM7QUFDSCxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDNUMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQzNDLGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO0FBRXZELHlCQUF5QjtBQUN6QixHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLGFBQWEsQ0FBQyxDQUFDO0FBQy9DLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQXNwZWN0cyB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEF3c1NvbHV0aW9uc0NoZWNrcyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgSW1hZ2VTdGFjayB9IGZyb20gJy4uL2xpYi9pbWFnZS1zdGFjayc7XG5pbXBvcnQgeyBBdXRoU3RhY2sgfSBmcm9tICcuLi9saWIvYXV0aC1zdGFjayc7XG5pbXBvcnQgeyBNQ1BSdW50aW1lU3RhY2sgfSBmcm9tICcuLi9saWIvbWNwLXJ1bnRpbWUtc3RhY2snO1xuaW1wb3J0IHsgQWdlbnRDb3JlR2F0ZXdheVN0YWNrIH0gZnJvbSAnLi4vbGliL2dhdGV3YXktc3RhY2snO1xuaW1wb3J0IHsgQWdlbnRSdW50aW1lU3RhY2sgfSBmcm9tICcuLi9saWIvYWdlbnQtcnVudGltZS1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIEFkZCBDREstTmFnIEFXUyBTb2x1dGlvbnMgY2hlY2tzXG5Bc3BlY3RzLm9mKGFwcCkuYWRkKG5ldyBBd3NTb2x1dGlvbnNDaGVja3MoeyB2ZXJib3NlOiB0cnVlIH0pKTtcblxuLy8gR2V0IGNvbmZpZ3VyYXRpb24gZnJvbSBjb250ZXh0IG9yIGVudmlyb25tZW50XG5jb25zdCBlbnYgPSB7XG4gIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxufTtcblxuY29uc3QgYWRtaW5FbWFpbCA9IHByb2Nlc3MuZW52LkFETUlOX0VNQUlMIHx8IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2FkbWluRW1haWwnKTtcblxuaWYgKCFhZG1pbkVtYWlsKSB7XG4gIGNvbnNvbGUuZXJyb3IoJ1xcbuKdjCBFUlJPUjogQURNSU5fRU1BSUwgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQuJyk7XG4gIGNvbnNvbGUuZXJyb3IoJ1BsZWFzZSBzZXQgaXQgYmVmb3JlIGRlcGxveWluZzonKTtcbiAgY29uc29sZS5lcnJvcignICBleHBvcnQgQURNSU5fRU1BSUw9XCJ5b3VyLWVtYWlsQGV4YW1wbGUuY29tXCInKTtcbiAgY29uc29sZS5lcnJvcignICBjZGsgZGVwbG95XFxuJyk7XG4gIHRocm93IG5ldyBFcnJvcignQURNSU5fRU1BSUwgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQuIFNldCBpdCBiZWZvcmUgZGVwbG95aW5nLicpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBWYWxpZGF0ZWQgRGVwbG95bWVudCBTZXF1ZW5jZVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBTdGFjayAxOiBJbWFnZSBTdGFjayAtIEJ1aWxkcyBEb2NrZXIgaW1hZ2VzIGZvciBBZ2VudCBSdW50aW1lc1xuY29uc3QgaW1hZ2VTdGFjayA9IG5ldyBJbWFnZVN0YWNrKGFwcCwgJ0Zpbk9wc0ltYWdlU3RhY2snLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGaW5PcHMgQWdlbnQgLSBEb2NrZXIgSW1hZ2UgQnVpbGQgKEVDUiArIENvZGVCdWlsZCknLFxufSk7XG5cbi8vIFN0YWNrIDI6IEF1dGggU3RhY2sgLSBDb2duaXRvICsgTTJNICsgT0F1dGggUHJvdmlkZXIgKEN1c3RvbSBSZXNvdXJjZSlcbmNvbnN0IGF1dGhTdGFjayA9IG5ldyBBdXRoU3RhY2soYXBwLCAnRmluT3BzQXV0aFN0YWNrJywge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnRmluT3BzIEFnZW50IC0gQ29nbml0byBBdXRoZW50aWNhdGlvbiArIE9BdXRoIFByb3ZpZGVyJyxcbiAgYWRtaW5FbWFpbDogYWRtaW5FbWFpbCxcbn0pO1xuXG4vLyBTdGFjayAzOiBNQ1AgUnVudGltZSBTdGFjayAtIERlcGxveSAyIE1DUCBSdW50aW1lcyB3aXRoIEpXVCBhdXRoXG5jb25zdCBtY3BSdW50aW1lU3RhY2sgPSBuZXcgTUNQUnVudGltZVN0YWNrKGFwcCwgJ0Zpbk9wc01DUFJ1bnRpbWVTdGFjaycsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zpbk9wcyBBZ2VudCAtIE1DUCBTZXJ2ZXIgUnVudGltZXMgKEJpbGxpbmcgKyBQcmljaW5nKSB3aXRoIEpXVCBBdXRob3JpemF0aW9uJyxcbiAgYmlsbGluZ01jcFJlcG9zaXRvcnk6IGltYWdlU3RhY2suYmlsbGluZ01jcFJlcG9zaXRvcnksXG4gIHByaWNpbmdNY3BSZXBvc2l0b3J5OiBpbWFnZVN0YWNrLnByaWNpbmdNY3BSZXBvc2l0b3J5LFxuICB1c2VyUG9vbElkOiBhdXRoU3RhY2sudXNlclBvb2xJZCxcbiAgbTJtQ2xpZW50SWQ6IGF1dGhTdGFjay5vYXV0aENsaWVudElkLFxufSk7XG5tY3BSdW50aW1lU3RhY2suYWRkRGVwZW5kZW5jeShpbWFnZVN0YWNrKTtcbm1jcFJ1bnRpbWVTdGFjay5hZGREZXBlbmRlbmN5KGF1dGhTdGFjayk7XG5cbi8vIFN0YWNrIDQ6IEFnZW50Q29yZSBHYXRld2F5IFN0YWNrIC0gR2F0ZXdheSArIGl0cyBvd24gQ29nbml0byArIE9BdXRoIHByb3ZpZGVyICsgTUNQIHRhcmdldHNcbmNvbnN0IGFnZW50Q29yZUdhdGV3YXlTdGFjayA9IG5ldyBBZ2VudENvcmVHYXRld2F5U3RhY2soYXBwLCAnRmluT3BzQWdlbnRDb3JlR2F0ZXdheVN0YWNrJywge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnRmluT3BzIEFnZW50IC0gR2F0ZXdheSB3aXRoIE1DUCBTZXJ2ZXIgVGFyZ2V0cycsXG4gIGJpbGxpbmdNY3BSdW50aW1lQXJuOiBtY3BSdW50aW1lU3RhY2suYmlsbGluZ01jcFJ1bnRpbWVBcm4sXG4gIHByaWNpbmdNY3BSdW50aW1lQXJuOiBtY3BSdW50aW1lU3RhY2sucHJpY2luZ01jcFJ1bnRpbWVBcm4sXG4gIGJpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQ6IG1jcFJ1bnRpbWVTdGFjay5iaWxsaW5nTWNwUnVudGltZUVuZHBvaW50LFxuICBwcmljaW5nTWNwUnVudGltZUVuZHBvaW50OiBtY3BSdW50aW1lU3RhY2sucHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCxcbiAgLy8gQXV0aFN0YWNrIENvZ25pdG8gZm9yIG91dGJvdW5kIE9BdXRoIHRvIHJ1bnRpbWVzXG4gIGF1dGhVc2VyUG9vbElkOiBhdXRoU3RhY2sudXNlclBvb2xJZCxcbiAgYXV0aFVzZXJQb29sQXJuOiBhdXRoU3RhY2sudXNlclBvb2xBcm4sXG4gIGF1dGhNMm1DbGllbnRJZDogYXV0aFN0YWNrLm9hdXRoQ2xpZW50SWQsXG59KTtcbmFnZW50Q29yZUdhdGV3YXlTdGFjay5hZGREZXBlbmRlbmN5KG1jcFJ1bnRpbWVTdGFjayk7XG5hZ2VudENvcmVHYXRld2F5U3RhY2suYWRkRGVwZW5kZW5jeShhdXRoU3RhY2spO1xuXG4vLyBTdGFjayA1OiBNYWluIFJ1bnRpbWUgU3RhY2sgLSBNYWluIGFnZW50IHJ1bnRpbWUgd2l0aCBHYXRld2F5IEFSTlxuY29uc3QgYWdlbnRSdW50aW1lU3RhY2sgPSBuZXcgQWdlbnRSdW50aW1lU3RhY2soYXBwLCAnRmluT3BzQWdlbnRSdW50aW1lU3RhY2snLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGaW5PcHMgQWdlbnQgLSBNYWluIEFnZW50IFJ1bnRpbWUgd2l0aCBHYXRld2F5IEludGVncmF0aW9uJyxcbiAgcmVwb3NpdG9yeTogaW1hZ2VTdGFjay5yZXBvc2l0b3J5LFxuICB1c2VyUG9vbEFybjogYXV0aFN0YWNrLnVzZXJQb29sQXJuLFxuICBnYXRld2F5QXJuOiBhZ2VudENvcmVHYXRld2F5U3RhY2suZ2F0ZXdheUFybixcbiAgdXNlclBvb2xJZDogYXV0aFN0YWNrLnVzZXJQb29sSWQsXG4gIHVzZXJQb29sQ2xpZW50SWQ6IGF1dGhTdGFjay51c2VyUG9vbENsaWVudElkLFxuICBpZGVudGl0eVBvb2xJZDogYXV0aFN0YWNrLmlkZW50aXR5UG9vbElkLFxufSk7XG5hZ2VudFJ1bnRpbWVTdGFjay5hZGREZXBlbmRlbmN5KGltYWdlU3RhY2spO1xuYWdlbnRSdW50aW1lU3RhY2suYWRkRGVwZW5kZW5jeShhdXRoU3RhY2spO1xuYWdlbnRSdW50aW1lU3RhY2suYWRkRGVwZW5kZW5jeShhZ2VudENvcmVHYXRld2F5U3RhY2spO1xuXG4vLyBBZGQgdGFncyB0byBhbGwgc3RhY2tzXG5jZGsuVGFncy5vZihhcHApLmFkZCgnUHJvamVjdCcsICdGaW5PcHNBZ2VudCcpO1xuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcbiJdfQ==