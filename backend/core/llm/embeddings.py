import httpx
from typing import List
from backend.config.settings import settings
from loguru import logger


class EmbeddingClient:
    """OpenAI Compatible Embedding Client"""

    def __init__(self, api_key: str = None, base_url: str = None, model: str = None, batch_size: int = 20):
        self.api_key = api_key or settings.embedding_api_key
        self.base_url = base_url or settings.embedding_base_url
        self.model = model or settings.embedding_model
        self.batch_size = batch_size

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """
        批量生成 Embedding 向量。

        为什么要分批？
        - Embedding API 通常有单次请求的 token/数量上限
        - 一次发送过多文本可能导致 400/413 错误
        - 分批发送更稳定，也便于控制并发
        """
        if not texts:
            return []

        logger.info(f"[Embedding] Generating embeddings for {len(texts)} texts")

        all_embeddings: List[List[float]] = []

        # 分批发送，每批 batch_size 条
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            logger.debug(f"[Embedding] Batch {i // self.batch_size + 1}: {len(batch)} texts")

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={"model": self.model, "input": batch},
                    timeout=60.0,
                )
                response.raise_for_status()
                data = response.json()

            batch_embeddings = [item["embedding"] for item in data["data"]]
            all_embeddings.extend(batch_embeddings)

        logger.info(f"[Embedding] Generated {len(all_embeddings)} embeddings, dim={len(all_embeddings[0])}")
        return all_embeddings

    async def embed_single(self, text: str) -> List[float]:
        """单条文本 Embedding"""
        results = await self.embed([text])
        return results[0]
