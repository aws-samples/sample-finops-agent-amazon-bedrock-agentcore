# Contributing to FinOps Agent

Thank you for your interest in contributing to the FinOps Agent project! This document provides guidelines for contributing.

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **Environment details** (OS, Node.js version, AWS region, etc.)
- **Logs or error messages** (sanitize any sensitive information)
- **Screenshots** if applicable

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear title and description**
- **Use case** - why is this enhancement needed?
- **Proposed solution** - how should it work?
- **Alternatives considered**
- **Additional context** - mockups, examples, etc.

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following the coding standards
3. **Test your changes** thoroughly
4. **Update documentation** if needed
5. **Commit your changes** with clear commit messages
6. **Push to your fork** and submit a pull request

#### Pull Request Guidelines

- Follow the existing code style
- Write clear, descriptive commit messages
- Include tests for new features
- Update documentation for API changes
- Keep pull requests focused on a single concern
- Reference related issues in the PR description

## Development Setup

### Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured
- Node.js 18+ and npm
- Python 3.13
- AWS CDK
- Docker (optional, for local testing)

### Local Development

```bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/finops-agentcore-solution.git
cd finops-agentcore-solution

# Install CDK dependencies
cd cdk
npm install

# Install Python dependencies
cd ../agentcore
pip install -r requirements.txt

# Install Lambda dependencies
cd ../lambda
pip install -r requirements.txt

# Install frontend dependencies
cd ../frontend
npm install
```

### Running Tests

```bash
# CDK tests
cd cdk
npm test

# Python tests
cd agentcore
pytest

# Frontend tests
cd frontend
npm test
```

### Code Style

#### TypeScript/JavaScript
- Use TypeScript for CDK code
- Follow ESLint rules
- Use meaningful variable names
- Add comments for complex logic

#### Python
- Follow PEP 8 style guide
- Use type hints
- Add docstrings for functions
- Keep functions focused and small

### Testing Your Changes

Before submitting a pull request:

1. **Deploy to your AWS account**
   ```bash
   export ADMIN_EMAIL="your-email@example.com"
   ./scripts/deploy.sh
   ```

2. **Test all affected functionality**
   - Test the specific feature you changed
   - Test related features
   - Test edge cases

3. **Clean up resources**
   ```bash
   ./scripts/cleanup.sh
   ```

## Project Structure

```
finops-agentcore-solution/
├── cdk/                    # CDK infrastructure
├── agentcore/             # Agent runtime code
├── lambda/                # MCP Lambda servers
├── frontend/              # Web application
├── scripts/               # Deployment scripts
├── docs/                  # Documentation
└── examples/              # Usage examples
```

## Adding New Tools

To add a new tool to the agent:

1. **Define the tool schema** in `cdk/lib/agent-stack.ts`:
   ```typescript
   {
     name: 'new_tool_name',
     description: 'Clear description of what the tool does',
     inputSchema: {
       type: agentcore.SchemaDefinitionType.OBJECT,
       properties: {
         param1: { type: STRING, description: 'Parameter description' },
         unique_flag: { type: BOOLEAN, description: 'Unique identifier' }
       },
       required: ['param1', 'unique_flag']
     }
   }
   ```

2. **Implement the tool** in appropriate Lambda (`billing_mcp_server.py` or `pricing_mcp_server.py`):
   ```python
   def new_tool_function(param1: str) -> Dict[str, Any]:
       """Tool implementation"""
       # Your code here
       return format_mcp_response(result)
   ```

3. **Add detection logic** in Lambda handler:
   ```python
   if 'unique_flag' in event:
       return new_tool_function(event['param1'])
   ```

4. **Update documentation**:
   - Add to `docs/TOOL-REFERENCE.md`
   - Add examples to `examples/sample-queries.md`
   - Update README.md tool count

5. **Test the new tool** thoroughly

## Documentation

- Keep documentation up to date with code changes
- Use clear, concise language
- Include code examples where helpful
- Add screenshots for UI changes

## Commit Messages

Use clear, descriptive commit messages:

```
feat: Add support for Reserved Instance recommendations
fix: Resolve token limit issue in memory management
docs: Update deployment guide with new prerequisites
refactor: Simplify tool detection logic
test: Add tests for pricing Lambda
```

Prefixes:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Questions?

Feel free to open an issue for:
- Questions about the codebase
- Clarification on contribution guidelines
- Discussion of potential features

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be recognized in the project README and release notes.

Thank you for contributing to the FinOps Agent project!
