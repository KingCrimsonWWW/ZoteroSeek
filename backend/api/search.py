"""
语义搜索 API — 使用 LangChain 向量检索

保留现有 ChromaDB 数据，通过 LangChain 的 similarity_search 接口调用。
"""

from fastapi import APIRouter
from pydantic import BaseModel
from backend.api.shared_deps import ensure_vector_store, vector_store
from loguru import logger

router = APIRouter(tags=["search"])


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


class SearchResult(BaseModel):
    id: str
    content: str
    metadata: dict
    score: float


class SearchResponse(BaseModel):
    results: list[SearchResult]


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """语义搜索 — 在已索引的论文知识库中查找相关内容"""
    try:
        await ensure_vector_store()

        # 使用现有的 Retriever（内部调用 EmbeddingClient + ChromaDB）
        # 不改用 LangChain retriever，因为现有的 EmbeddingClient 已经可用
        from backend.core.rag.retriever import Retriever
        from backend.api.shared_deps import embedder

        retriever = Retriever(embedder=embedder, vector_store=vector_store)
        results = await retriever.search(query=request.query, top_k=request.top_k)

        return SearchResponse(
            results=[
                SearchResult(
                    id=r.id,
                    content=r.content,
                    metadata=r.metadata,
                    score=r.score,
                )
                for r in results
            ]
        )
    except Exception as e:
        logger.exception(f"[Search] Error: {e}")
        return SearchResponse(results=[])
