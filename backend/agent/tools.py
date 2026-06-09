"""
Agent 工具定义 — LangChain @tool + LangChain Chroma 向量检索

search_knowledge 直接使用 LangChain Chroma 的 similarity_search，
不再经过手写 Retriever。
"""

from langchain_core.tools import tool
from loguru import logger


@tool
async def search_knowledge(query: str, top_k: int = 5) -> str:
    """搜索已索引的学术论文知识库。当用户询问关于论文内容、研究方法、学术概念等问题时，必须先使用此工具搜索相关文献片段。

    Args:
        query: 搜索查询（自然语言）
        top_k: 返回结果数量（默认 5）
    """
    from backend.api.shared_deps import lc_vectorstore

    # 直接使用 LangChain Chroma 的相似度搜索
    results = lc_vectorstore.similarity_search_with_score(query, k=top_k)

    if not results:
        return "未找到相关文献。知识库中可能没有与该查询相关的内容。"

    parts = []
    for i, (doc, score) in enumerate(results, 1):
        title = doc.metadata.get("title", "Unknown")
        section = doc.metadata.get("section_type", "")
        similarity = round(1 - score, 3)
        parts.append(f"[{i}] {title} ({section}) [相关度: {similarity}]\n{doc.page_content[:500]}")

    return "\n\n---\n\n".join(parts)


@tool
async def query_library() -> str:
    """查看已索引的文献库列表。当用户问"我有哪些论文"、"文献库有什么"时使用。

    Returns:
        已索引文献的列表（标题、作者、年份）
    """
    from backend.data.db import SessionLocal
    from backend.data.models import Item

    db = SessionLocal()
    try:
        items = db.query(Item).all()
        if not items:
            return "文献库为空，尚未索引任何论文。"

        lines = []
        for item in items:
            lines.append(f"- {item.title} ({item.year or 'N/A'}) [{item.index_status}]")
        return f"已索引 {len(items)} 篇文献：\n" + "\n".join(lines)
    finally:
        db.close()


@tool
async def index_document(pdf_path: str, item_id: str = "manual", extractor: str = "mineru") -> str:
    """索引一篇新的 PDF 论文到知识库。当用户提供 PDF 文件路径要求索引时使用。

    Args:
        pdf_path: PDF 文件的完整路径
        item_id: 文献 ID（可选，默认 "manual"）
        extractor: 提取引擎 "mineru"（默认，高质量）或 "pymupdf"（快速）
    """
    from backend.api.shared_deps import embedder, vector_store, parser, chunker
    from backend.core.pipeline.interfaces import PipelineContext
    from backend.core.pipeline.ingestion import IngestionPipeline
    from backend.extractors.pdf import PDFExtractor
    from backend.extractors.mineru_extractor import MinerUExtractor

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
        return f"索引成功！共创建 {result.chunks_created} 个文档块，耗时 {result.duration_ms:.0f}ms。"
    else:
        return f"索引失败：{result.error}"
