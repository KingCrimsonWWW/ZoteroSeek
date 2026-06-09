"""
共享依赖单例 — LangChain 生态组件

使用 LangChain 的 OpenAIEmbeddings 和 Chroma 替代手写的
EmbeddingClient 和 ChromaVectorStore。

保留自研的 SemanticChunker 和 DocumentParser（LangChain 替代方案不支持 Markdown 感知）。
"""

from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma
from backend.config.settings import settings
from backend.core.llm.adapters import EmbeddingsAdapter, VectorStoreAdapter
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker

# ── LangChain 原生组件 ──────────────────────────────────────

# LangChain Embedding（替代手写 EmbeddingClient）
lc_embeddings = OpenAIEmbeddings(
    api_key=settings.embedding_api_key or "dummy",
    base_url=settings.embedding_base_url,
    model=settings.embedding_model,
)

# LangChain Chroma（替代手写 ChromaVectorStore）
# collection_name="research" 与现有数据兼容
lc_vectorstore = Chroma(
    collection_name="research",
    embedding_function=lc_embeddings,
    persist_directory=settings.chroma_path,
)

# ── 适配器（供 IngestionPipeline 使用）─────────────────────────

embedder = EmbeddingsAdapter(lc_embeddings)
vector_store = VectorStoreAdapter(lc_vectorstore)

# ── 自研组件（保留，LangChain 替代方案不支持 Markdown 感知）─────────

parser = DocumentParser()
chunker = SemanticChunker()

# ── 兼容旧 API ──────────────────────────────────────────────

async def ensure_vector_store():
    """兼容旧代码调用 — LangChain Chroma 自动初始化，此函数为空操作"""
    pass
