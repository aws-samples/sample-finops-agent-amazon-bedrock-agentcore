import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
export interface AgentRuntimeStackProps extends cdk.StackProps {
    repository: ecr.IRepository;
    userPoolArn: string;
    gatewayArn: string;
}
export declare class AgentRuntimeStack extends cdk.Stack {
    readonly mainRuntimeArn: string;
    readonly memoryId: string;
    readonly mainRuntimeRole: iam.IRole;
    readonly mainRuntimeRoleArn: string;
    constructor(scope: Construct, id: string, props: AgentRuntimeStackProps);
}
