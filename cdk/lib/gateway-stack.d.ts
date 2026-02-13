import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface AgentCoreGatewayStackProps extends cdk.StackProps {
    billingMcpRuntimeArn: string;
    billingMcpRuntimeEndpoint: string;
    pricingMcpRuntimeArn: string;
    pricingMcpRuntimeEndpoint: string;
    authUserPoolId: string;
    authUserPoolArn: string;
    authM2mClientId: string;
}
export declare class AgentCoreGatewayStack extends cdk.Stack {
    readonly gatewayArn: string;
    readonly gatewayUrl: string;
    constructor(scope: Construct, id: string, props: AgentCoreGatewayStackProps);
}
