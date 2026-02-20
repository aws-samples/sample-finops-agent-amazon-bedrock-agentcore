import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
/**
 * ImageStack: Builds Docker images for MCP server runtimes using the
 * stdio-to-HTTP transformation pattern.
 *
 * For each MCP server (billing, pricing):
 *   1. CodeBuild clones the upstream AWS Labs MCP repo
 *   2. transform-{server}.sh patches server.py for streamable-http transport
 *   3. Adds uvicorn + starlette dependencies
 *   4. Patches Dockerfile (EXPOSE 8000, entrypoint, healthcheck)
 *   5. Builds ARM64 Docker image and pushes to ECR
 *
 * Based on: https://github.com/aws-samples/sample-aws-stdio-http-proxy-mcp
 */
export declare class ImageStack extends cdk.Stack {
    readonly repository: ecr.Repository;
    readonly billingMcpRepository: ecr.Repository;
    readonly pricingMcpRepository: ecr.Repository;
    readonly sourceBucket: s3.Bucket;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
    /**
     * Create a CodeBuild project that clones upstream MCP repo,
     * applies transformation scripts, builds ARM64 Docker image,
     * and pushes to ECR.
     */
    private createTransformBuildProject;
    /**
     * Build the main agent runtime image using standard Docker build
     * (no transformation needed - it's our own code).
     */
    private buildMainRuntimeImage;
}
