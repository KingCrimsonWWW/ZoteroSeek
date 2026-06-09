"""
语义搜索 API — 使用 LangChain Chroma 向量检索
"""

from fastapi import APIRouter
from pydantic import BaseModel
from backend.api.shared_deps import lc_vectorstore
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
    """语义搜索 — 使用 LangChain Chroma similarity_search_with_score"""
    try:
        # LangChain Chroma 返回 (Document, score) 元组
        results = lc_vectorstore.similarity_search_with_score(
            request.query, k=request.top_k,
        )

        return SearchResponse(
            results=[
                SearchResult(
                    id=doc.metadata.get("item_id", "unknown"),
                    content=doc.page_content,
                    metadata=doc.metadata,
                    score=1 - score,  # Chroma distance → similarity
                )
                for doc, score in results
            ]
        )
    except Exception as e:
        logger.exception(f"[Search] Error: {e}")
        return SearchResponse(results=[])
