from typing import List, Optional
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.vector_store import VectorStore, VectorResult
from loguru import logger


class Retriever:
    """Semantic retriever using vector search"""

    def __init__(self, embedder: EmbeddingClient, vector_store: VectorStore):
        self.embedder = embedder
        self.vector_store = vector_store

    async def search(
        self,
        query: str,
        top_k: int = 5,
        item_filter: Optional[str] = None,
    ) -> List[VectorResult]:
        """Search for similar chunks"""
        logger.info(f"[Retriever] Searching: '{query[:50]}...' (top_k={top_k})")

        # Embed query
        query_embedding = await self.embedder.embed_single(query)

        # Build filters
        filters = {}
        if item_filter:
            filters["item_id"] = item_filter

        # Search vector store
        results = await self.vector_store.query(
            vector=query_embedding,
            top_k=top_k,
            filters=filters if filters else None,
        )

        logger.info(f"[Retriever] Found {len(results)} results")
        return results
