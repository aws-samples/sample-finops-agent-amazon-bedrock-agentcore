#!/bin/bash
set -euo pipefail

echo "=== Transformation Script: Clone and Transform Pricing MCP Server ==="

# Clone upstream repository
echo "Cloning upstream MCP repository..."
git clone --depth 1 https://github.com/awslabs/mcp.git
cd mcp/src/aws-pricing-mcp-server

SERVER_FILE="awslabs/aws_pricing_mcp_server/server.py"

# Transform server.py
echo "Transforming server.py..."

python3 -c "
import re

with open('$SERVER_FILE', 'r') as f:
    content = f.read()

# 1. Patch FastMCP constructor: add host and stateless_http=True
old_constructor = \"mcp = FastMCP(\"
new_constructor = \"mcp = FastMCP(host='0.0.0.0', stateless_http=True,\"
if old_constructor in content:
    content = content.replace(old_constructor, new_constructor, 1)
    print('FastMCP constructor patched with host and stateless_http=True')
else:
    print('ERROR: Could not find FastMCP constructor')
    exit(1)

# 2. Replace main() function
old_main = '''def main():
    \"\"\"Run the MCP server with CLI argument support.\"\"\"
    mcp.run()'''

new_main = '''def create_starlette_app():
    \"\"\"Create the Starlette ASGI app for streamable-http transport.\"\"\"
    import contextlib
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Mount, Route

    async def ping(request):
        return JSONResponse({\"status\": \"ok\"})

    async def health(request):
        return JSONResponse({\"status\": \"healthy\"})

    @contextlib.asynccontextmanager
    async def lifespan(starlette_app):
        async with mcp.session_manager.run():
            yield

    starlette_app = Starlette(
        routes=[
            Route(\"/ping\", ping, methods=[\"GET\"]),
            Route(\"/health\", health, methods=[\"GET\"]),
            Mount(\"/\", app=mcp.streamable_http_app()),
        ],
        lifespan=lifespan,
    )
    return starlette_app


def main():
    \"\"\"Run the MCP server with streamable-http transport via uvicorn.\"\"\"
    import uvicorn
    starlette_app = create_starlette_app()
    uvicorn.run(starlette_app, host=\"0.0.0.0\", port=8000, log_level=\"info\")'''

if old_main in content:
    content = content.replace(old_main, new_main)
    print('main() function patched')
else:
    print('ERROR: Could not find expected main() function pattern')
    match = re.search(r'def main\(\).*?(?=\ndef |\Z)', content, re.DOTALL)
    if match:
        print(f'Found main(): {match.group(0)[:200]}...')
    exit(1)

with open('$SERVER_FILE', 'w') as f:
    f.write(content)

print('server.py transformation complete')
"

# Validate transformation
grep -q 'uvicorn' "$SERVER_FILE" || { echo "ERROR: uvicorn not found in server.py"; exit 1; }
grep -q 'streamable_http_app' "$SERVER_FILE" || { echo "ERROR: streamable_http_app not found"; exit 1; }
grep -q 'stateless_http=True' "$SERVER_FILE" || { echo "ERROR: stateless_http not found"; exit 1; }
echo "server.py transformation verified."

# Add uvicorn and starlette dependencies to pyproject.toml
echo "Adding uvicorn and starlette dependencies..."
python3 -c "
with open('pyproject.toml', 'r') as f:
    content = f.read()

import re
content = re.sub(
    r'(dependencies\s*=\s*\[)',
    r'\1\n    \"uvicorn>=0.30.0\",\n    \"starlette>=0.38.0\",',
    content,
    count=1
)

with open('pyproject.toml', 'w') as f:
    f.write(content)
print('Dependencies added to pyproject.toml')
"
grep -q 'uvicorn' pyproject.toml || { echo "ERROR: uvicorn not in pyproject.toml"; exit 1; }
echo "pyproject.toml transformation verified."

# Disable UV_FROZEN in Dockerfile
echo "Disabling UV_FROZEN in Dockerfile..."
sed -i 's/UV_FROZEN=1/UV_FROZEN=0/g' Dockerfile
sed -i '/ENV UV_FROZEN/d' Dockerfile
echo "UV_FROZEN handling complete."

# Transform Dockerfile: add EXPOSE and update entrypoint
echo "Transforming Dockerfile..."
grep -q 'EXPOSE 8000' Dockerfile || sed -i '/^HEALTHCHECK/i EXPOSE 8000' Dockerfile
sed -i 's|ENTRYPOINT.*|ENTRYPOINT ["python", "-m", "awslabs.aws_pricing_mcp_server.server"]|' Dockerfile
grep -q 'EXPOSE 8000' Dockerfile || { echo "ERROR: EXPOSE 8000 not in Dockerfile"; exit 1; }
echo "Dockerfile transformation verified."

# Transform healthcheck
echo "Transforming docker-healthcheck.sh..."
cat > docker-healthcheck.sh << 'HEALTHCHECK_EOF'
#!/bin/bash
curl -sf http://localhost:8000/mcp || exit 1
HEALTHCHECK_EOF
chmod +x docker-healthcheck.sh
echo "Healthcheck transformation verified."

echo "=== All pricing MCP server transformations complete ==="
