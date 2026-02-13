import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
export interface AuthStackProps extends cdk.StackProps {
    adminEmail: string;
}
export declare class AuthStack extends cdk.Stack {
    readonly userPoolId: string;
    readonly userPoolClientId: string;
    readonly identityPoolId: string;
    readonly userPoolArn: string;
    readonly userPoolProviderName: string;
    readonly oauthClientId: string;
    readonly oauthClientSecret: cdk.SecretValue;
    readonly oauthTokenEndpoint: string;
    readonly oauthAuthorizationEndpoint: string;
    readonly oauthIssuer: string;
    readonly oauthCredentialsSecret: secretsmanager.ISecret;
    readonly oauthProviderName: string;
    readonly oauthProviderArn: string;
    constructor(scope: Construct, id: string, props: AuthStackProps);
}
