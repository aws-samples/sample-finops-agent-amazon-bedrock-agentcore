import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';
import { NagSuppressions } from 'cdk-nag';

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
export class ImageStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  public readonly billingMcpRepository: ecr.Repository;
  public readonly pricingMcpRepository: ecr.Repository;
  public readonly sourceBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ECR Repository for Main Agent Runtime image
    this.repository = new ecr.Repository(this, 'RuntimeRepository', {
      repositoryName: 'finops-agent-runtime',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
      lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
    });

    // ECR Repository for Billing MCP Server Runtime
    this.billingMcpRepository = new ecr.Repository(this, 'BillingMcpRepository', {
      repositoryName: 'finops-billing-mcp-runtime',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
      lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
    });

    // ECR Repository for Pricing MCP Server Runtime
    this.pricingMcpRepository = new ecr.Repository(this, 'PricingMcpRepository', {
      repositoryName: 'finops-pricing-mcp-runtime',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
      lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
    });

    // S3 Bucket for CodeBuild source (buildspec + transform scripts)
    this.sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        { id: 'DeleteOldVersions', enabled: true, noncurrentVersionExpiration: cdk.Duration.days(30) },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Upload codebuild-scripts to S3
    const scriptsDeployment = new s3deploy.BucketDeployment(this, 'CodeBuildScriptsDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../codebuild-scripts'))],
      destinationBucket: this.sourceBucket,
      destinationKeyPrefix: 'codebuild-scripts/',
      extract: true,
      prune: false,
      retainOnDelete: false,
      memoryLimit: 512,
    });

    // Also upload agentcore directory for main runtime build
    const agentcoreDeployment = new s3deploy.BucketDeployment(this, 'AgentcoreSourceDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../agentcore'))],
      destinationBucket: this.sourceBucket,
      destinationKeyPrefix: 'agentcore/',
    });

    // --- Build Trigger Lambda ---
    const buildTriggerFn = new lambda.Function(this, 'BuildTriggerFunction', {
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-trigger')),
      timeout: cdk.Duration.minutes(1),
      memorySize: 128,
      description: 'Triggers CodeBuild build for MCP server container',
    });

    // --- Build Waiter Lambda ---
    const buildWaiterFn = new lambda.Function(this, 'BuildWaiterFunction', {
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-waiter')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      description: 'Polls CodeBuild build status until completion',
    });

    // ========================================
    // Billing MCP Server - CodeBuild + Transform
    // ========================================
    const billingBuildProject = this.createTransformBuildProject(
      'BillingMcp',
      this.billingMcpRepository,
      'codebuild-scripts/',
      'buildspec-billing.yml',
    );
    billingBuildProject.node.addDependency(scriptsDeployment);

    // Grant Lambda permissions
    buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:StartBuild'],
      resources: [billingBuildProject.projectArn],
    }));
    buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:BatchGetBuilds'],
      resources: [billingBuildProject.projectArn],
    }));

    // Trigger billing build
    const billingBuildTrigger = new cdk.CustomResource(this, 'BillingBuildTrigger', {
      serviceToken: buildTriggerFn.functionArn,
      properties: {
        ProjectName: billingBuildProject.projectName,
        Timestamp: new Date().toISOString(),
      },
    });
    billingBuildTrigger.node.addDependency(scriptsDeployment);

    // Wait for billing build
    const billingBuildWaiter = new cdk.CustomResource(this, 'BillingBuildWaiter', {
      serviceToken: buildWaiterFn.functionArn,
      properties: {
        BuildId: billingBuildTrigger.getAttString('BuildId'),
        MaxWaitSeconds: '1200',
      },
    });
    billingBuildWaiter.node.addDependency(billingBuildTrigger);

    // ========================================
    // Pricing MCP Server - CodeBuild + Transform
    // ========================================
    const pricingBuildProject = this.createTransformBuildProject(
      'PricingMcp',
      this.pricingMcpRepository,
      'codebuild-scripts/',
      'buildspec-pricing.yml',
    );
    pricingBuildProject.node.addDependency(scriptsDeployment);

    // Grant Lambda permissions for pricing
    buildTriggerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:StartBuild'],
      resources: [pricingBuildProject.projectArn],
    }));
    buildWaiterFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:BatchGetBuilds'],
      resources: [pricingBuildProject.projectArn],
    }));

    // Trigger pricing build
    const pricingBuildTrigger = new cdk.CustomResource(this, 'PricingBuildTrigger', {
      serviceToken: buildTriggerFn.functionArn,
      properties: {
        ProjectName: pricingBuildProject.projectName,
        Timestamp: new Date().toISOString(),
      },
    });
    pricingBuildTrigger.node.addDependency(scriptsDeployment);

    // Wait for pricing build
    const pricingBuildWaiter = new cdk.CustomResource(this, 'PricingBuildWaiter', {
      serviceToken: buildWaiterFn.functionArn,
      properties: {
        BuildId: pricingBuildTrigger.getAttString('BuildId'),
        MaxWaitSeconds: '1200',
      },
    });
    pricingBuildWaiter.node.addDependency(pricingBuildTrigger);

    // ========================================
    // Main Agent Runtime - Standard Docker Build
    // ========================================
    this.buildMainRuntimeImage(agentcoreDeployment);

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'MainRepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'Main Runtime ECR Repository URI',
      exportName: `${this.stackName}-MainRepositoryUri`,
    });

    new cdk.CfnOutput(this, 'BillingMcpRepositoryUri', {
      value: this.billingMcpRepository.repositoryUri,
      description: 'Billing MCP Runtime ECR Repository URI',
      exportName: `${this.stackName}-BillingMcpRepositoryUri`,
    });

    new cdk.CfnOutput(this, 'PricingMcpRepositoryUri', {
      value: this.pricingMcpRepository.repositoryUri,
      description: 'Pricing MCP Runtime ECR Repository URI',
      exportName: `${this.stackName}-PricingMcpRepositoryUri`,
    });

    new cdk.CfnOutput(this, 'SourceBucketName', {
      value: this.sourceBucket.bucketName,
      description: 'S3 bucket for CodeBuild source scripts',
    });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================
    NagSuppressions.addResourceSuppressions(this.sourceBucket, [
      { id: 'AwsSolutions-S1', reason: 'Server access logging not enabled for dev/demo.' },
    ]);

    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-L1', reason: 'Lambda runtime version managed by CDK.' },
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard permissions required for S3, ECR, CloudWatch, CodeBuild.' },
      { id: 'AwsSolutions-CB4', reason: 'KMS encryption not enabled for dev/demo.' },
    ]);
  }

  /**
   * Create a CodeBuild project that clones upstream MCP repo,
   * applies transformation scripts, builds ARM64 Docker image,
   * and pushes to ECR.
   */
  private createTransformBuildProject(
    id: string,
    repository: ecr.Repository,
    sourcePath: string,
    buildspecFile: string,
  ): codebuild.Project {
    const codeBuildRole = new iam.Role(this, `${id}CodeBuildRole`, {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: `IAM role for CodeBuild to build ${id} container image`,
      inlinePolicies: {
        CloudWatchLogsPolicy: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [`arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/codebuild/*`],
          })],
        }),
        ECRPushPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage',
                'ecr:PutImage', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload',
              ],
              resources: [repository.repositoryArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ecr:GetAuthorizationToken'],
              resources: ['*'],
            }),
          ],
        }),
        S3ReadPolicy: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:GetObjectVersion'],
            resources: [this.sourceBucket.arnForObjects('*')],
          })],
        }),
      },
    });

    const project = new codebuild.Project(this, `${id}BuildProject`, {
      projectName: `finops-${id.toLowerCase()}-build`,
      description: `Build ARM64 container for ${id} with streamable-http transport`,
      source: codebuild.Source.s3({
        bucket: this.sourceBucket,
        path: sourcePath,
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(buildspecFile),
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        environmentVariables: {
          AWS_DEFAULT_REGION: { value: cdk.Aws.REGION },
          AWS_ACCOUNT_ID: { value: cdk.Aws.ACCOUNT_ID },
          ECR_REPO_URI: { value: repository.repositoryUri },
        },
      },
      role: codeBuildRole,
      timeout: cdk.Duration.minutes(30),
    });

    NagSuppressions.addResourceSuppressions(codeBuildRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ecr:GetAuthorizationToken, S3, CloudWatch Logs.' },
    ], true);

    NagSuppressions.addResourceSuppressions(project, [
      { id: 'AwsSolutions-CB4', reason: 'KMS encryption not enabled for dev/demo.' },
    ]);

    return project;
  }

  /**
   * Build the main agent runtime image using standard Docker build
   * (no transformation needed - it's our own code).
   */
  private buildMainRuntimeImage(sourceDeployment: s3deploy.BucketDeployment): void {
    const buildProject = new codebuild.Project(this, 'MainRuntimeBuildProject', {
      projectName: 'finops-mainruntime-build',
      source: codebuild.Source.s3({
        bucket: this.sourceBucket,
        path: 'agentcore/',
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        privileged: true,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        AWS_DEFAULT_REGION: { value: this.region },
        AWS_ACCOUNT_ID: { value: this.account },
        IMAGE_REPO_NAME: { value: this.repository.repositoryName },
        IMAGE_TAG: { value: 'latest' },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
            ],
          },
          build: {
            commands: [
              'echo Building the Docker image...',
              'docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
              'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
            ],
          },
          post_build: {
            commands: [
              'echo Pushing the Docker image...',
              'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
            ],
          },
        },
      }),
    });

    this.repository.grantPullPush(buildProject);
    this.sourceBucket.grantRead(buildProject);
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));

    const triggerFn = new cdk.aws_lambda.Function(this, 'MainRuntimeBuildTriggerFn', {
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '../../lambda/build-trigger')),
      timeout: cdk.Duration.minutes(1),
    });
    triggerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:StartBuild'],
      resources: [buildProject.projectArn],
    }));
    triggerFn.node.addDependency(sourceDeployment);

    new cdk.CustomResource(this, 'MainRuntimeTriggerBuild', {
      serviceToken: triggerFn.functionArn,
      properties: {
        ProjectName: buildProject.projectName,
        Timestamp: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      },
    });

    NagSuppressions.addResourceSuppressions(buildProject, [
      { id: 'AwsSolutions-CB4', reason: 'KMS encryption not enabled for dev/demo.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard for ECR, S3, CloudWatch.' },
    ], true);
  }
}
