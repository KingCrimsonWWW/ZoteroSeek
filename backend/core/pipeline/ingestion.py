"""
文档摄入流水线（Ingestion Pipeline）—— 将原始文档转换为可检索的向量

这是整个 RAG 系统的核心编排模块，负责串联 5 个阶段：
    Source → Extract → Parse → Chunk → Embed → Store

设计模式：
1. 管道模式（Pipeline Pattern）：每个阶段专注于单一职责，串联执行
2. 依赖注入（Dependency Injection）：所有组件通过构造函数注入，而非内部创建
   这样做的好处：
   - 测试时可以轻松替换为 Mock 对象
   - 组件之间松耦合，可以独立演进
   - 配置集中在应用启动时，而非散落在各处
3. 每个阶段都是可替换的策略（Strategy），例如：
   - 换一个 extractor 就能支持新的文档格式
   - 换一个 embedder 就能切换嵌入模型
   - 换一个 vector_store 就能切换向量数据库

错误处理策略：
- 使用 try-except 包裹整个流水线，任何阶段失败都会被优雅捕获
- 返回 PipelineResult 而非抛出异常，让调用方决定如何处理失败
"""

import time
from typing import List
from backend.core.pipeline.interfaces import PipelineContext, PipelineResult
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.vector_store import VectorStore
from backend.extractors.base import Extractor
from loguru import logger


class IngestionPipeline:
    """
    Document Ingestion Pipeline

    Source → Extract → Parse → Chunk → Embed → Store
    """

    # 构造函数采用依赖注入模式（Dependency Injection）
    # 每个参数都是一个实现了特定接口的组件：
    #   - extractor: 文档提取器（如 MinerUExtractor），负责从原始文件中提取文本
    #   - parser: 文档解析器，负责将提取的原始文本转换为结构化的 CanonicalDocument
    #   - chunker: 语义分块器，负责将长文档切分为适合嵌入的小块
    #   - embedder: 嵌入客户端，负责将文本块转换为向量表示
    #   - vector_store: 向量存储，负责持久化向量并提供相似性检索
    def __init__(
        self,
        extractor: Extractor,
        parser: DocumentParser,
        chunker: SemanticChunker,
        embedder: EmbeddingClient,
        vector_store: VectorStore,
    ):
        self.extractor = extractor
        self.parser = parser
        self.chunker = chunker
        self.embedder = embedder
        self.vector_store = vector_store

    async def ingest(self, ctx: PipelineContext) -> PipelineResult:
        """Execute full pipeline"""
        start = time.time()

        try:
            # ==================== 阶段 1：提取（Extract）====================
            # 调用提取器从原始文件（PDF 等）中提取文本内容
            # 返回 RawContent 对象，包含提取的文本、内容类型和元数据
            # 这一步可能涉及网络请求（如 MinerU API），所以是 async
            logger.info(f"[Pipeline] Extracting: {ctx.source_path}")
            raw = await self.extractor.extract(ctx.source_path)

            # ==================== 阶段 2：解析（Parse）====================
            # 将提取器输出的 RawContent 转换为规范化的 CanonicalDocument
            # CanonicalDocument 包含结构化的标题、作者、章节等信息
            # 这一步是纯本地计算，不涉及 I/O，所以是同步调用
            logger.info(f"[Pipeline] Parsing: {ctx.item_id}")
            document = self.parser.parse(raw, ctx.item_id)

            # ==================== 阶段 3：分块（Chunk）====================
            # 将长文档按语义边界切分为多个 Chunk
            # 每个 Chunk 包含文本内容和元数据（标题路径、章节类型等）
            # 分块大小受 max_tokens 限制，确保不超过嵌入模型的上下文窗口
            logger.info(f"[Pipeline] Chunking: {ctx.item_id}")
            chunks = self.chunker.chunk(document)

            # 如果分块结果为空，说明文档内容过少或解析失败，直接返回失败结果
            if not chunks:
                return PipelineResult(
                    success=False,
                    item_id=ctx.item_id,
                    error="No chunks created",
                    duration_ms=(time.time() - start) * 1000,
                )

            # ==================== 阶段 4：嵌入（Embed）====================
            # 批量将文本块转换为向量表示
            # 使用批量处理（而非逐条处理）以减少 API 调用次数，提高效率
            # 嵌入后的向量被附加到对应的 Chunk 对象上
            logger.info(f"[Pipeline] Embedding {len(chunks)} chunks")
            texts = [c.content for c in chunks]
            embeddings = await self.embedder.embed(texts)
            for chunk, emb in zip(chunks, embeddings):
                chunk.embedding = emb

            # ==================== 阶段 5：存储（Store）====================
            # 将向量、文本和元数据一起写入向量数据库
            # 使用 upsert（update or insert）语义，支持重复导入时的幂等更新
            # metadata 使用 model_dump() 将 Pydantic 模型序列化为字典
            logger.info(f"[Pipeline] Storing {len(chunks)} chunks")
            await self.vector_store.upsert(
                ids=[c.id for c in chunks],
                embeddings=[c.embedding for c in chunks],
                documents=[c.content for c in chunks],
                metadatas=[c.metadata.model_dump() for c in chunks],
            )

            elapsed = (time.time() - start) * 1000
            logger.info(f"[Pipeline] Completed: {ctx.item_id}, {len(chunks)} chunks in {elapsed:.0f}ms")

            return PipelineResult(
                success=True,
                item_id=ctx.item_id,
                chunks_created=len(chunks),
                duration_ms=elapsed,
            )
        except Exception as e:
            # 统一异常处理：捕获任何阶段的异常，记录错误日志，返回失败结果
            # 这种设计避免了未处理异常导致整个应用崩溃
            logger.error(f"[Pipeline] Failed: {ctx.item_id} - {e}")
            return PipelineResult(
                success=False,
                item_id=ctx.item_id,
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )
