from fastapi import APIRouter
from pydantic import BaseModel
from backend.core.rag.retriever import Retriever
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.chroma_store import ChromaVectorStore

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

embedder = EmbeddingClient()
vector_store = ChromaVectorStore()

@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """Semantic search"""
    await vector_store.initialize()
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
