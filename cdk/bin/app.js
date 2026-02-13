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
});
agentRuntimeStack.addDependency(imageStack);
agentRuntimeStack.addDependency(authStack);
agentRuntimeStack.addDependency(agentCoreGatewayStack);
// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'FinOpsAgent');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLHVDQUFxQztBQUNyQyxpREFBbUM7QUFDbkMsNkNBQXNDO0FBQ3RDLHFDQUE2QztBQUM3QyxvREFBZ0Q7QUFDaEQsa0RBQThDO0FBQzlDLGdFQUEyRDtBQUMzRCx3REFBNkQ7QUFDN0Qsb0VBQStEO0FBRS9ELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLG1DQUFtQztBQUNuQyxxQkFBTyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSw0QkFBa0IsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFFL0QsZ0RBQWdEO0FBQ2hELE1BQU0sR0FBRyxHQUFHO0lBQ1YsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO0lBQ3hDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLFdBQVc7Q0FDdEQsQ0FBQztBQUVGLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRW5GLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUNoQixPQUFPLENBQUMsS0FBSyxDQUFDLDBEQUEwRCxDQUFDLENBQUM7SUFDMUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0lBQ2pELE9BQU8sQ0FBQyxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQztJQUMvRCxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7SUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQyx3RUFBd0UsQ0FBQyxDQUFDO0FBQzVGLENBQUM7QUFFRCwyQ0FBMkM7QUFDM0MsZ0NBQWdDO0FBQ2hDLDJDQUEyQztBQUUzQyxpRUFBaUU7QUFDakUsTUFBTSxVQUFVLEdBQUcsSUFBSSx3QkFBVSxDQUFDLEdBQUcsRUFBRSxrQkFBa0IsRUFBRTtJQUN6RCxHQUFHO0lBQ0gsV0FBVyxFQUFFLHFEQUFxRDtDQUNuRSxDQUFDLENBQUM7QUFFSCx5RUFBeUU7QUFDekUsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEdBQUcsRUFBRSxpQkFBaUIsRUFBRTtJQUN0RCxHQUFHO0lBQ0gsV0FBVyxFQUFFLHdEQUF3RDtJQUNyRSxVQUFVLEVBQUUsVUFBVTtDQUN2QixDQUFDLENBQUM7QUFFSCxtRUFBbUU7QUFDbkUsTUFBTSxlQUFlLEdBQUcsSUFBSSxtQ0FBZSxDQUFDLEdBQUcsRUFBRSx1QkFBdUIsRUFBRTtJQUN4RSxHQUFHO0lBQ0gsV0FBVyxFQUFFLCtFQUErRTtJQUM1RixvQkFBb0IsRUFBRSxVQUFVLENBQUMsb0JBQW9CO0lBQ3JELG9CQUFvQixFQUFFLFVBQVUsQ0FBQyxvQkFBb0I7SUFDckQsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVO0lBQ2hDLFdBQVcsRUFBRSxTQUFTLENBQUMsYUFBYTtDQUNyQyxDQUFDLENBQUM7QUFDSCxlQUFlLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQzFDLGVBQWUsQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUM7QUFFekMsOEZBQThGO0FBQzlGLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxxQ0FBcUIsQ0FBQyxHQUFHLEVBQUUsNkJBQTZCLEVBQUU7SUFDMUYsR0FBRztJQUNILFdBQVcsRUFBRSxnREFBZ0Q7SUFDN0Qsb0JBQW9CLEVBQUUsZUFBZSxDQUFDLG9CQUFvQjtJQUMxRCxvQkFBb0IsRUFBRSxlQUFlLENBQUMsb0JBQW9CO0lBQzFELHlCQUF5QixFQUFFLGVBQWUsQ0FBQyx5QkFBeUI7SUFDcEUseUJBQXlCLEVBQUUsZUFBZSxDQUFDLHlCQUF5QjtJQUNwRSxtREFBbUQ7SUFDbkQsY0FBYyxFQUFFLFNBQVMsQ0FBQyxVQUFVO0lBQ3BDLGVBQWUsRUFBRSxTQUFTLENBQUMsV0FBVztJQUN0QyxlQUFlLEVBQUUsU0FBUyxDQUFDLGFBQWE7Q0FDekMsQ0FBQyxDQUFDO0FBQ0gscUJBQXFCLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxDQUFDO0FBQ3JELHFCQUFxQixDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUUvQyxvRUFBb0U7QUFDcEUsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLHVDQUFpQixDQUFDLEdBQUcsRUFBRSx5QkFBeUIsRUFBRTtJQUM5RSxHQUFHO0lBQ0gsV0FBVyxFQUFFLDREQUE0RDtJQUN6RSxVQUFVLEVBQUUsVUFBVSxDQUFDLFVBQVU7SUFDakMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxXQUFXO0lBQ2xDLFVBQVUsRUFBRSxxQkFBcUIsQ0FBQyxVQUFVO0NBQzdDLENBQUMsQ0FBQztBQUNILGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUM1QyxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDM0MsaUJBQWlCLENBQUMsYUFBYSxDQUFDLHFCQUFxQixDQUFDLENBQUM7QUFFdkQseUJBQXlCO0FBQ3pCLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsYUFBYSxDQUFDLENBQUM7QUFDL0MsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBBc3BlY3RzIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQXdzU29sdXRpb25zQ2hlY2tzIH0gZnJvbSAnY2RrLW5hZyc7XG5pbXBvcnQgeyBJbWFnZVN0YWNrIH0gZnJvbSAnLi4vbGliL2ltYWdlLXN0YWNrJztcbmltcG9ydCB7IEF1dGhTdGFjayB9IGZyb20gJy4uL2xpYi9hdXRoLXN0YWNrJztcbmltcG9ydCB7IE1DUFJ1bnRpbWVTdGFjayB9IGZyb20gJy4uL2xpYi9tY3AtcnVudGltZS1zdGFjayc7XG5pbXBvcnQgeyBBZ2VudENvcmVHYXRld2F5U3RhY2sgfSBmcm9tICcuLi9saWIvZ2F0ZXdheS1zdGFjayc7XG5pbXBvcnQgeyBBZ2VudFJ1bnRpbWVTdGFjayB9IGZyb20gJy4uL2xpYi9hZ2VudC1ydW50aW1lLXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gQWRkIENESy1OYWcgQVdTIFNvbHV0aW9ucyBjaGVja3NcbkFzcGVjdHMub2YoYXBwKS5hZGQobmV3IEF3c1NvbHV0aW9uc0NoZWNrcyh7IHZlcmJvc2U6IHRydWUgfSkpO1xuXG4vLyBHZXQgY29uZmlndXJhdGlvbiBmcm9tIGNvbnRleHQgb3IgZW52aXJvbm1lbnRcbmNvbnN0IGVudiA9IHtcbiAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gfHwgJ3VzLWVhc3QtMScsXG59O1xuXG5jb25zdCBhZG1pbkVtYWlsID0gcHJvY2Vzcy5lbnYuQURNSU5fRU1BSUwgfHwgYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnYWRtaW5FbWFpbCcpO1xuXG5pZiAoIWFkbWluRW1haWwpIHtcbiAgY29uc29sZS5lcnJvcignXFxu4p2MIEVSUk9SOiBBRE1JTl9FTUFJTCBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZC4nKTtcbiAgY29uc29sZS5lcnJvcignUGxlYXNlIHNldCBpdCBiZWZvcmUgZGVwbG95aW5nOicpO1xuICBjb25zb2xlLmVycm9yKCcgIGV4cG9ydCBBRE1JTl9FTUFJTD1cInlvdXItZW1haWxAZXhhbXBsZS5jb21cIicpO1xuICBjb25zb2xlLmVycm9yKCcgIGNkayBkZXBsb3lcXG4nKTtcbiAgdGhyb3cgbmV3IEVycm9yKCdBRE1JTl9FTUFJTCBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZC4gU2V0IGl0IGJlZm9yZSBkZXBsb3lpbmcuJyk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFZhbGlkYXRlZCBEZXBsb3ltZW50IFNlcXVlbmNlXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIFN0YWNrIDE6IEltYWdlIFN0YWNrIC0gQnVpbGRzIERvY2tlciBpbWFnZXMgZm9yIEFnZW50IFJ1bnRpbWVzXG5jb25zdCBpbWFnZVN0YWNrID0gbmV3IEltYWdlU3RhY2soYXBwLCAnRmluT3BzSW1hZ2VTdGFjaycsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zpbk9wcyBBZ2VudCAtIERvY2tlciBJbWFnZSBCdWlsZCAoRUNSICsgQ29kZUJ1aWxkKScsXG59KTtcblxuLy8gU3RhY2sgMjogQXV0aCBTdGFjayAtIENvZ25pdG8gKyBNMk0gKyBPQXV0aCBQcm92aWRlciAoQ3VzdG9tIFJlc291cmNlKVxuY29uc3QgYXV0aFN0YWNrID0gbmV3IEF1dGhTdGFjayhhcHAsICdGaW5PcHNBdXRoU3RhY2snLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGaW5PcHMgQWdlbnQgLSBDb2duaXRvIEF1dGhlbnRpY2F0aW9uICsgT0F1dGggUHJvdmlkZXInLFxuICBhZG1pbkVtYWlsOiBhZG1pbkVtYWlsLFxufSk7XG5cbi8vIFN0YWNrIDM6IE1DUCBSdW50aW1lIFN0YWNrIC0gRGVwbG95IDIgTUNQIFJ1bnRpbWVzIHdpdGggSldUIGF1dGhcbmNvbnN0IG1jcFJ1bnRpbWVTdGFjayA9IG5ldyBNQ1BSdW50aW1lU3RhY2soYXBwLCAnRmluT3BzTUNQUnVudGltZVN0YWNrJywge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnRmluT3BzIEFnZW50IC0gTUNQIFNlcnZlciBSdW50aW1lcyAoQmlsbGluZyArIFByaWNpbmcpIHdpdGggSldUIEF1dGhvcml6YXRpb24nLFxuICBiaWxsaW5nTWNwUmVwb3NpdG9yeTogaW1hZ2VTdGFjay5iaWxsaW5nTWNwUmVwb3NpdG9yeSxcbiAgcHJpY2luZ01jcFJlcG9zaXRvcnk6IGltYWdlU3RhY2sucHJpY2luZ01jcFJlcG9zaXRvcnksXG4gIHVzZXJQb29sSWQ6IGF1dGhTdGFjay51c2VyUG9vbElkLFxuICBtMm1DbGllbnRJZDogYXV0aFN0YWNrLm9hdXRoQ2xpZW50SWQsXG59KTtcbm1jcFJ1bnRpbWVTdGFjay5hZGREZXBlbmRlbmN5KGltYWdlU3RhY2spO1xubWNwUnVudGltZVN0YWNrLmFkZERlcGVuZGVuY3koYXV0aFN0YWNrKTtcblxuLy8gU3RhY2sgNDogQWdlbnRDb3JlIEdhdGV3YXkgU3RhY2sgLSBHYXRld2F5ICsgaXRzIG93biBDb2duaXRvICsgT0F1dGggcHJvdmlkZXIgKyBNQ1AgdGFyZ2V0c1xuY29uc3QgYWdlbnRDb3JlR2F0ZXdheVN0YWNrID0gbmV3IEFnZW50Q29yZUdhdGV3YXlTdGFjayhhcHAsICdGaW5PcHNBZ2VudENvcmVHYXRld2F5U3RhY2snLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGaW5PcHMgQWdlbnQgLSBHYXRld2F5IHdpdGggTUNQIFNlcnZlciBUYXJnZXRzJyxcbiAgYmlsbGluZ01jcFJ1bnRpbWVBcm46IG1jcFJ1bnRpbWVTdGFjay5iaWxsaW5nTWNwUnVudGltZUFybixcbiAgcHJpY2luZ01jcFJ1bnRpbWVBcm46IG1jcFJ1bnRpbWVTdGFjay5wcmljaW5nTWNwUnVudGltZUFybixcbiAgYmlsbGluZ01jcFJ1bnRpbWVFbmRwb2ludDogbWNwUnVudGltZVN0YWNrLmJpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQsXG4gIHByaWNpbmdNY3BSdW50aW1lRW5kcG9pbnQ6IG1jcFJ1bnRpbWVTdGFjay5wcmljaW5nTWNwUnVudGltZUVuZHBvaW50LFxuICAvLyBBdXRoU3RhY2sgQ29nbml0byBmb3Igb3V0Ym91bmQgT0F1dGggdG8gcnVudGltZXNcbiAgYXV0aFVzZXJQb29sSWQ6IGF1dGhTdGFjay51c2VyUG9vbElkLFxuICBhdXRoVXNlclBvb2xBcm46IGF1dGhTdGFjay51c2VyUG9vbEFybixcbiAgYXV0aE0ybUNsaWVudElkOiBhdXRoU3RhY2sub2F1dGhDbGllbnRJZCxcbn0pO1xuYWdlbnRDb3JlR2F0ZXdheVN0YWNrLmFkZERlcGVuZGVuY3kobWNwUnVudGltZVN0YWNrKTtcbmFnZW50Q29yZUdhdGV3YXlTdGFjay5hZGREZXBlbmRlbmN5KGF1dGhTdGFjayk7XG5cbi8vIFN0YWNrIDU6IE1haW4gUnVudGltZSBTdGFjayAtIE1haW4gYWdlbnQgcnVudGltZSB3aXRoIEdhdGV3YXkgQVJOXG5jb25zdCBhZ2VudFJ1bnRpbWVTdGFjayA9IG5ldyBBZ2VudFJ1bnRpbWVTdGFjayhhcHAsICdGaW5PcHNBZ2VudFJ1bnRpbWVTdGFjaycsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zpbk9wcyBBZ2VudCAtIE1haW4gQWdlbnQgUnVudGltZSB3aXRoIEdhdGV3YXkgSW50ZWdyYXRpb24nLFxuICByZXBvc2l0b3J5OiBpbWFnZVN0YWNrLnJlcG9zaXRvcnksXG4gIHVzZXJQb29sQXJuOiBhdXRoU3RhY2sudXNlclBvb2xBcm4sXG4gIGdhdGV3YXlBcm46IGFnZW50Q29yZUdhdGV3YXlTdGFjay5nYXRld2F5QXJuLFxufSk7XG5hZ2VudFJ1bnRpbWVTdGFjay5hZGREZXBlbmRlbmN5KGltYWdlU3RhY2spO1xuYWdlbnRSdW50aW1lU3RhY2suYWRkRGVwZW5kZW5jeShhdXRoU3RhY2spO1xuYWdlbnRSdW50aW1lU3RhY2suYWRkRGVwZW5kZW5jeShhZ2VudENvcmVHYXRld2F5U3RhY2spO1xuXG4vLyBBZGQgdGFncyB0byBhbGwgc3RhY2tzXG5jZGsuVGFncy5vZihhcHApLmFkZCgnUHJvamVjdCcsICdGaW5PcHNBZ2VudCcpO1xuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcbiJdfQ==