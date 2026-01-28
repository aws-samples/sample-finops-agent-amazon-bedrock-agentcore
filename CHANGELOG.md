# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-26

### Added
- Initial release of FinOps Agent using Amazon Bedrock AgentCore
- AgentCore Runtime with Strands framework and Amazon Nova Pro
- AgentCore Gateway for tool routing and authentication
- AgentCore Memory with 30-day conversation retention
- Billing MCP Server with 11 cost analysis tools:
  - Cost Explorer integration
  - AWS Budgets tracking
  - Compute Optimizer recommendations
  - Free Tier usage monitoring
  - Cost forecasting
  - Anomaly detection
  - Rightsizing recommendations
  - Savings Plans recommendations
- Pricing MCP Server with 9 pricing tools:
  - AWS Pricing API integration
  - EC2 pricing lookup
  - RDS pricing lookup
  - Lambda pricing lookup
  - Service code discovery
  - Attribute value queries
  - Rate comparison
- CDK infrastructure with 3 stacks:
  - ImageStack for ECR and CodeBuild
  - AgentStack for Runtime, Gateway, Memory, and Lambdas
  - AuthStack for Cognito authentication
- Deployment scripts (deploy.sh, cleanup.sh)
- Comprehensive documentation:
  - Architecture overview
  - Deployment guide
  - Tool reference
  - Troubleshooting guide
  - Example queries and code samples
- AWS Amplify frontend support (deployment package separate)

### Features
- Conversational AI interface for AWS cost management
- Natural language queries for cost analysis
- Real-time cost data from AWS Cost Explorer
- Budget tracking and alerts
- Optimization recommendations
- Pricing comparisons across services
- IAM-based security
- Auto-scaling runtime
- Production-ready architecture

### Technical Details
- Runtime: Python 3.13 with Strands SDK
- Model: Amazon Nova Pro (us.amazon.nova-pro-v1:0)
- Container: ARM64 Docker image on ECS Fargate
- Authentication: Amazon Cognito with IAM roles
- Memory: 30-day retention per session
- Region: us-east-1

## [Unreleased]

### Planned
- Frontend React application (AWS Amplify deployment package)
- Additional cost optimization tools
- Multi-region support
- Enhanced visualization features
- Cost allocation tag support
- Custom budget templates

---

## Release Notes

### Version 1.0.0 - Initial Release

This is the first production release of the FinOps Agent built on Amazon Bedrock AgentCore. The solution provides a conversational AI interface for AWS cost management, combining:

- **Amazon Bedrock AgentCore** - Production-ready agent platform
- **Amazon Nova Pro** - Advanced foundation model
- **Strands Framework** - Modern Python agent SDK
- **Model Context Protocol (MCP)** - Standardized tool integration
- **20 Specialized Tools** - Comprehensive cost management capabilities

The architecture follows AWS best practices with:
- Containerized runtime on ECS Fargate
- IAM-based security
- CloudWatch monitoring
- Auto-scaling capabilities
- Conversational memory

For detailed deployment instructions, see [docs/DEPLOYMENT-GUIDE.md](docs/DEPLOYMENT-GUIDE.md).

For tool documentation, see [docs/TOOL-REFERENCE.md](docs/TOOL-REFERENCE.md).

---

## Support

For issues, questions, or contributions, please see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
