import httpx
from typing import List
from backend.config.settings import settings
from loguru import logger

class EmbeddingClient:
    """OpenAI Compatible Embedding Client"""
    
    def __init__(self, api_key: str = None, base_url: str = None, model: str = None):
        self.api_key = api_key or settings.embedding_api_key
        self.base_url = base_url or settings.embedding_base_url
        self.model = model or settings.embedding_model
    
    async def embed(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts"""
        if not texts:
            return []
        
        logger.info(f"[Embedding] Generating embeddings for {len(texts)} texts")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "input": texts},
                timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()
        
        embeddings = [item["embedding"] for item in data["data"]]
        logger.info(f"[Embedding] Generated {len(embeddings)} embeddings, dim={len(embeddings[0])}")
        
        return embeddings
    
    async def embed_single(self, text: str) -> List[float]:
        """Generate embedding for a single text"""
        results = await self.embed([text])
        return results[0]
