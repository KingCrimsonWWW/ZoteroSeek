"""
LangChain 适配器 — 让现有 IngestionPipeline 与 LangChain 组件兼容

IngestionPipeline 期望：
- embedder.embed(texts) → List[List[float]]
- vector_store.upsert(ids, embeddings, documents, metadatas)

LangChain 提供：
- OpenAIEmbeddings.embed_documents(texts) → List[List[float]]
- Chroma.add_texts(texts, metadatas, ids)

这两个适配器桥接两种接口。
"""

from typing import List, Optional, Dict, Any
from loguru import logger


class EmbeddingsAdapter:
    """将 LangChain OpenAIEmbeddings 适配为 Pipeline 期望的接口"""

    def __init__(self, langchain_embeddings):
        self._embeddings = langchain_embeddings

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """批量生成 Embedding（供 IngestionPipeline 使用）"""
        logger.info(f"[EmbeddingsAdapter] Embedding {len(texts)} texts")
        # OpenAIEmbeddings.embed_documents 是同步的，用 asyncio 包裹
        import asyncio
        return await asyncio.to_thread(self._embeddings.embed_documents, texts)

    async def embed_single(self, text: str) -> List[float]:
        """单条文本 Embedding（供 Retriever/Agent 使用）"""
        import asyncio
        return await asyncio.to_thread(self._embeddings.embed_query, text)


class VectorStoreAdapter:
    """将 LangChain Chroma 适配为 Pipeline 期望的接口"""

    def __init__(self, langchain_vectorstore):
        self._vs = langchain_vectorstore

    async def upsert(
        self, ids: List[str], embeddings: List[List[float]],
        documents: List[str], metadatas: List[Dict[str, Any]],
    ) -> None:
        """写入向量（供 IngestionPipeline 使用）"""
        import asyncio
        if not ids:
            return
        logger.info(f"[VectorStoreAdapter] Upserting {len(ids)} chunks")
        await asyncio.to_thread(
            self._vs._collection.upsert,
            ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas,
        )

    async def query(
        self, vector: List[float], top_k: int = 5, filters: Optional[Dict] = None,
    ):
        """向量检索（供旧 Retriever 兼容，新代码直接用 LangChain 接口）"""
        import asyncio
        from backend.data.vector_store import VectorResult

        results = await asyncio.to_thread(
            self._vs._collection.query,
            query_embeddings=[vector], n_results=top_k,
            where=filters if filters else None,
            include=["documents", "metadatas", "distances"],
        )
        return [
            VectorResult(
                id=results["ids"][0][i],
                content=results["documents"][0][i],
                metadata=results["metadatas"][0][i],
                score=1 - results["distances"][0][i],
            )
            for i in range(len(results["ids"][0]))
        ]

    async def initialize(self):
        """兼容旧代码调用（LangChain Chroma 自动初始化）"""
        pass
