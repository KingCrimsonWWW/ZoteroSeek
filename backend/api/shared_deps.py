"""
共享依赖单例 — 避免各 API 模块重复创建客户端实例

为什么抽取？
- EmbeddingClient / ChromaVectorStore 等在多个 API 模块中使用
- 每次 import 时创建实例 → 资源浪费
- 每次请求调用 initialize() → 重复初始化
- 统一管理生命周期，便于后续添加连接池、缓存等优化
"""

from backend.core.llm.embeddings import EmbeddingClient
from backend.core.llm.client import LLMClient
from backend.core.prompts.registry import PromptRegistry
from backend.data.chroma_store import ChromaVectorStore
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker

# 模块级单例 — 整个应用共享
embedder = EmbeddingClient()
llm_client = LLMClient()
prompt_registry = PromptRegistry()
vector_store = ChromaVectorStore()
parser = DocumentParser()
chunker = SemanticChunker()

# 向量存储初始化状态标记
_vector_store_initialized = False

async def ensure_vector_store():
    """确保向量存储已初始化（幂等，只初始化一次）"""
    global _vector_store_initialized
    if not _vector_store_initialized:
        await vector_store.initialize()
        _vector_store_initialized = True
