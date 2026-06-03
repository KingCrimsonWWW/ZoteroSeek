from fastapi import APIRouter
from pydantic import BaseModel
from backend.core.rag.retriever import Retriever
from backend.api.shared_deps import embedder, vector_store, ensure_vector_store
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
    """语义搜索"""
    try:
        await ensure_vector_store()
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
