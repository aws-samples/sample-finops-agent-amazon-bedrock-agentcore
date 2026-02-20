import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
export interface MCPRuntimeStackProps extends cdk.StackProps {
    billingMcpRepository: ecr.IRepository;
    pricingMcpRepository: ecr.IRepository;
    userPoolId: string;
    m2mClientId: string;
}
export declare class MCPRuntimeStack extends cdk.Stack {
    readonly billingMcpRuntimeArn: string;
    readonly pricingMcpRuntimeArn: string;
    readonly billingMcpRuntimeEndpoint: string;
    readonly pricingMcpRuntimeEndpoint: string;
    constructor(scope: Construct, id: string, props: MCPRuntimeStackProps);
}
