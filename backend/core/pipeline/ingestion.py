import time
from typing import List
from backend.core.pipeline.interfaces import PipelineContext, PipelineResult
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.vector_store import VectorStore
from backend.extractors.base import Extractor
from loguru import logger

class IngestionPipeline:
    """
    Document Ingestion Pipeline

    Source → Extract → Parse → Chunk → Embed → Store
    """

    def __init__(
        self,
        extractor: Extractor,
        parser: DocumentParser,
        chunker: SemanticChunker,
        embedder: EmbeddingClient,
        vector_store: VectorStore,
    ):
        self.extractor = extractor
        self.parser = parser
        self.chunker = chunker
        self.embedder = embedder
        self.vector_store = vector_store

    async def ingest(self, ctx: PipelineContext) -> PipelineResult:
        """Execute full pipeline"""
        start = time.time()

        try:
            # Stage 1: Extract
            logger.info(f"[Pipeline] Extracting: {ctx.source_path}")
            raw = await self.extractor.extract(ctx.source_path)

            # Stage 2: Parse → CanonicalDocument
            logger.info(f"[Pipeline] Parsing: {ctx.item_id}")
            document = self.parser.parse(raw, ctx.item_id)

            # Stage 3: Chunk
            logger.info(f"[Pipeline] Chunking: {ctx.item_id}")
            chunks = self.chunker.chunk(document)

            if not chunks:
                return PipelineResult(
                    success=False,
                    item_id=ctx.item_id,
                    error="No chunks created",
                    duration_ms=(time.time() - start) * 1000,
                )

            # Stage 4: Embed
            logger.info(f"[Pipeline] Embedding {len(chunks)} chunks")
            texts = [c.content for c in chunks]
            embeddings = await self.embedder.embed(texts)
            for chunk, emb in zip(chunks, embeddings):
                chunk.embedding = emb

            # Stage 5: Store
            logger.info(f"[Pipeline] Storing {len(chunks)} chunks")
            await self.vector_store.upsert(
                ids=[c.id for c in chunks],
                embeddings=[c.embedding for c in chunks],
                documents=[c.content for c in chunks],
                metadatas=[c.metadata.model_dump() for c in chunks],
            )

            elapsed = (time.time() - start) * 1000
            logger.info(f"[Pipeline] Completed: {ctx.item_id}, {len(chunks)} chunks in {elapsed:.0f}ms")

            return PipelineResult(
                success=True,
                item_id=ctx.item_id,
                chunks_created=len(chunks),
                duration_ms=elapsed,
            )
        except Exception as e:
            logger.error(f"[Pipeline] Failed: {ctx.item_id} - {e}")
            return PipelineResult(
                success=False,
                item_id=ctx.item_id,
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )
