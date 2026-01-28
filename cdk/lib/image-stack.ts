import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';
import { NagSuppressions } from 'cdk-nag';

export class ImageStack extends cdk.Stack {
  public readonly imageUri: string;
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ECR Repository for Agent Runtime image
    this.repository = new ecr.Repository(this, 'RuntimeRepository', {
      repositoryName: 'finops-agent-runtime',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    });

    // S3 bucket for source code
    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true, // Require SSL/TLS for all requests
    });

    // Upload agentcore directory to S3
    const sourceDeployment = new s3deploy.BucketDeployment(this, 'SourceDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../agentcore'))],
      destinationBucket: sourceBucket,
      destinationKeyPrefix: 'agentcore',
    });

    // CodeBuild project to build and push Docker image
    const buildProject = new codebuild.Project(this, 'ImageBuildProject', {
      projectName: 'finops-agent-image-build',
      source: codebuild.Source.s3({
        bucket: sourceBucket,
        path: 'agentcore/',
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        privileged: true, // Required for Docker builds
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        AWS_DEFAULT_REGION: {
          value: this.region,
        },
        AWS_ACCOUNT_ID: {
          value: this.account,
        },
        IMAGE_REPO_NAME: {
          value: this.repository.repositoryName,
        },
        IMAGE_TAG: {
          value: 'latest',
        },
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
              'echo Build started on `date`',
              'echo Building the Docker image...',
              'docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
              'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
            ],
          },
          post_build: {
            commands: [
              'echo Build completed on `date`',
              'echo Pushing the Docker image...',
              'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
              'echo Image URI: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
            ],
          },
        },
      }),
    });

    // Grant CodeBuild permissions to push to ECR
    this.repository.grantPullPush(buildProject);

    // Grant CodeBuild permissions to read from S3 source bucket
    sourceBucket.grantRead(buildProject);

    // Add ECR permissions explicitly
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'ecr:PutImage',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
      ],
      resources: ['*'],
    }));

    // Custom resource to trigger the build
    const triggerBuild = new cdk.CustomResource(this, 'TriggerBuild', {
      serviceToken: this.createBuildTriggerProvider(buildProject, sourceDeployment).serviceToken,
      properties: {
        ProjectName: buildProject.projectName,
        Timestamp: Date.now(), // Force rebuild on every deployment
      },
    });

    // Construct image URI
    this.imageUri = `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${this.repository.repositoryName}:latest`;

    // Outputs
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'ECR Repository URI',
      exportName: `${this.stackName}-RepositoryUri`,
    });

    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      description: 'Docker Image URI',
      exportName: `${this.stackName}-ImageUri`,
    });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================

    // S3 Bucket suppressions - temporary build artifact bucket
    NagSuppressions.addResourceSuppressions(sourceBucket, [
      {
        id: 'AwsSolutions-S1',
        reason: 'Server access logs not required for temporary build artifact bucket that is auto-deleted on stack removal',
      },
    ], true);

    // CodeBuild suppressions
    NagSuppressions.addResourceSuppressions(buildProject, [
      {
        id: 'AwsSolutions-CB4',
        reason: 'KMS encryption not required for temporary build project that builds Docker images from public source code',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required: (1) ECR GetAuthorizationToken applies to all repositories, (2) S3 actions for source bucket objects, (3) CloudWatch Logs for build logs, (4) CodeBuild report groups',
      },
    ], true);

    // Stack-level suppressions for Lambda functions created by CDK custom resources
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-L1',
        reason: 'Python 3.13 is the latest Lambda runtime version available',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for: (1) S3 bucket operations for CDK asset deployment, (2) Lambda function version invocation',
      },
    ]);
  }

  private createBuildTriggerProvider(
    buildProject: codebuild.Project,
    sourceDeployment: s3deploy.BucketDeployment
  ): cdk.custom_resources.Provider {
    const onEvent = new cdk.aws_lambda.Function(this, 'BuildTriggerFunction', {
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_13,
      handler: 'index.handler',
      code: cdk.aws_lambda.Code.fromInline(`
import boto3
import json

codebuild = boto3.client('codebuild')

def handler(event, context):
    print(f"Event: {json.dumps(event)}")
    request_type = event['RequestType']
    
    if request_type == 'Create' or request_type == 'Update':
        project_name = event['ResourceProperties']['ProjectName']
        print(f"Starting build for project: {project_name}")
        
        try:
            response = codebuild.start_build(projectName=project_name)
            build_id = response['build']['id']
            print(f"Build started: {build_id}")
            
            return {
                'PhysicalResourceId': build_id,
                'Data': {
                    'BuildId': build_id
                }
            }
        except Exception as e:
            print(f"Error starting build: {str(e)}")
            raise
    
    return {
        'PhysicalResourceId': event.get('PhysicalResourceId', 'build-trigger')
    }
      `),
      timeout: cdk.Duration.minutes(5),
    });

    // Grant permissions to start builds
    onEvent.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codebuild:StartBuild'],
      resources: [buildProject.projectArn],
    }));

    // Ensure source is deployed before triggering build
    onEvent.node.addDependency(sourceDeployment);

    return new cdk.custom_resources.Provider(this, 'BuildTriggerProvider', {
      onEventHandler: onEvent,
    });
  }
}
