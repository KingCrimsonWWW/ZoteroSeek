"""
ZoteroSeek MCP Server — 将知识库能力标准化暴露给 AI 工具

MCP (Model Context Protocol) 是 Anthropic 推出的标准化协议，
让 Claude / Cursor / ChatGPT 等 AI 工具可以调用外部能力。

本 Server 暴露 4 个工具：
- search_papers: 语义搜索已索引的论文
- ask_papers: 基于论文知识库的 RAG 问答
- list_papers: 查看已索引文献列表
- index_pdf: 索引新的 PDF 论文

使用方式：
  python -m mcp_server                    # stdio 模式（Claude Desktop 用）
  python -m mcp_server --transport sse    # SSE 模式（调试用）
"""

import asyncio
import sys
from pathlib import Path

# 将项目根目录加入 Python 路径，以便导入 backend 模块
sys.path.insert(0, str(Path(__file__).parent.parent))

from mcp.server.fastmcp import FastMCP
from loguru import logger

# ── 创建 MCP Server ──────────────────────────────────────────

mcp = FastMCP("zoteroseek")


# ── 工具 1: 语义搜索 ─────────────────────────────────────────

@mcp.tool()
async def search_papers(query: str, top_k: int = 5) -> str:
    """搜索已索引的学术论文知识库。返回与查询最相关的论文段落。

    当用户询问论文内容、研究方法、学术概念时使用此工具。
    搜索基于语义相似度（不只是关键词匹配），支持自然语言查询。

    Args:
        query: 搜索查询（自然语言，如 "spatial community detection methods"）
        top_k: 返回结果数量（默认 5，最大 20）
    """
    from backend.api.shared_deps import lc_vectorstore

    top_k = min(max(top_k, 1), 20)
    logger.info(f"[MCP] search_papers: query='{query}', top_k={top_k}")

    results = lc_vectorstore.similarity_search_with_score(query, k=top_k)

    if not results:
        return "未找到相关文献。知识库可能为空，请先使用 index_pdf 索引论文。"

    parts = []
    for i, (doc, distance) in enumerate(results, 1):
        title = doc.metadata.get("title", "Unknown")
        section = doc.metadata.get("section_type", "")
        authors = doc.metadata.get("authors", "Unknown")
        similarity = round(1 - distance, 3)
        parts.append(
            f"[{i}] {title}\n"
            f"    Authors: {authors} | Section: {section} | Similarity: {similarity}\n"
            f"    {doc.page_content[:400]}"
        )

    return "\n\n".join(parts)


# ── 工具 2: RAG 问答 ─────────────────────────────────────────

@mcp.tool()
async def ask_papers(question: str) -> str:
    """基于论文知识库回答学术问题（RAG + Agent）。

    系统会自动：
    1. 搜索相关论文段落
    2. 组装上下文
    3. 让 LLM 基于真实文献生成回答
    4. 附带引用来源

    适合需要综合分析、对比、总结的问题。
    简单的文献列表查询请用 list_papers，精确搜索请用 search_papers。

    Args:
        question: 学术问题（如 "STOCS 方法的原理是什么？"）
    """
    from backend.agent.graph import get_agent

    logger.info(f"[MCP] ask_papers: question='{question[:80]}'")

    agent = get_agent()
    result = await agent.ainvoke({"messages": [("human", question)]})

    # 提取最后一条 AI 消息
    for msg in reversed(result["messages"]):
        if hasattr(msg, "content") and msg.content and msg.type == "ai":
            return msg.content

    return "未能生成回答。"


# ── 工具 3: 文献列表 ─────────────────────────────────────────

@mcp.tool()
async def list_papers() -> str:
    """查看已索引的所有论文列表。

    返回每篇论文的标题、作者、年份和索引状态。
    用于回答"我有哪些论文"、"文献库有什么"等问题。
    """
    from backend.data.db import SessionLocal
    from backend.data.models import Item

    db = SessionLocal()
    try:
        items = db.query(Item).all()
        if not items:
            return "文献库为空，尚未索引任何论文。请使用 index_pdf 工具索引 PDF。"

        lines = []
        for item in items:
            # authors 字段是 JSON 字符串
            import json
            try:
                authors = json.loads(item.authors) if item.authors else []
            except (json.JSONDecodeError, TypeError):
                authors = [item.authors] if item.authors else []
            authors_str = ", ".join(authors) if authors else "Unknown"

            lines.append(
                f"- [{item.id}] {item.title}\n"
                f"  Authors: {authors_str} | Year: {item.year or 'N/A'} | Status: {item.index_status}"
            )

        return f"已索引 {len(items)} 篇文献：\n\n" + "\n\n".join(lines)
    finally:
        db.close()


# ── 工具 4: 索引 PDF ─────────────────────────────────────────

@mcp.tool()
async def index_pdf(pdf_path: str, item_id: str = "manual", extractor: str = "mineru") -> str:
    """索引一篇新的 PDF 论文到知识库。

    处理流程：PDF → 文本提取 → 语义分块 → 向量化 → 存入 ChromaDB。
    索引完成后即可通过 search_papers 和 ask_papers 检索。

    Args:
        pdf_path: PDF 文件的完整本地路径（如 "D:/papers/study.pdf"）
        item_id: 文献标识（可选，默认 "manual"，如用 Zotero key 则填 Zotero item key）
        extractor: 提取引擎 — "mineru"（默认，ML 布局分析，质量高但较慢）或 "pymupdf"（快速，纯文本提取）
    """
    from backend.api.shared_deps import embedder, vector_store, parser, chunker
    from backend.core.pipeline.interfaces import PipelineContext
    from backend.core.pipeline.ingestion import IngestionPipeline
    from backend.extractors.pdf import PDFExtractor
    from backend.extractors.mineru_extractor import MinerUExtractor

    logger.info(f"[MCP] index_pdf: path='{pdf_path}', extractor={extractor}")

    extractors = {"mineru": MinerUExtractor, "pymupdf": PDFExtractor}
    extractor_cls = extractors.get(extractor, MinerUExtractor)

    pipeline = IngestionPipeline(
        extractor=extractor_cls(),
        parser=parser,
        chunker=chunker,
        embedder=embedder,
        vector_store=vector_store,
    )

    ctx = PipelineContext(item_id=item_id, source_path=pdf_path)
    result = await pipeline.ingest(ctx)

    if result.success:
        return (
            f"索引成功！\n"
            f"- 文献 ID: {result.item_id}\n"
            f"- 创建文档块: {result.chunks_created} 个\n"
            f"- 耗时: {result.duration_ms:.0f}ms\n"
            f"- 提取引擎: {extractor}\n\n"
            f"现在可以使用 search_papers 或 ask_papers 检索这篇论文。"
        )
    else:
        return f"索引失败：{result.error}"


# ── 入口 ──────────────────────────────────────────────────────

def main():
    """启动 MCP Server"""
    import argparse

    parser = argparse.ArgumentParser(description="ZoteroSeek MCP Server")
    parser.add_argument(
        "--transport", choices=["stdio", "sse"], default="stdio",
        help="传输协议: stdio (Claude Desktop 默认) 或 sse (调试用)",
    )
    parser.add_argument("--port", type=int, default=8080, help="SSE 模式端口")

    args = parser.parse_args()

    logger.info(f"[MCP] Starting ZoteroSeek MCP Server (transport={args.transport})")

    if args.transport == "sse":
        mcp.settings.port = args.port
        mcp.run(transport="sse")
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
