import sys
from pathlib import Path

# 确保项目根目录在 Python 路径中（无论从哪里启动）
# Claude Desktop 启动 MCP Server 时工作目录不确定
project_root = str(Path(__file__).parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from mcp_server.server import main

main()
