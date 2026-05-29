from typing import List, Tuple
from backend.core.rag.retriever import Retriever
from backend.core.prompts.registry import PromptRegistry
from backend.data.vector_store import VectorResult
from loguru import logger


class ChatIntegration:
    """RAG chat integration - retrieves context and builds prompts"""

    def __init__(self, retriever: Retriever, prompt_registry: PromptRegistry):
        self.retriever = retriever
        self.prompt_registry = prompt_registry

    async def augment_query(
        self, query: str, top_k: int = 5
    ) -> Tuple[str, List[VectorResult]]:
        """
        Augment a query with RAG context.

        Returns:
            (augmented_prompt, sources) - the prompt with context and source references
        """
        logger.info(f"[ChatIntegration] Augmenting query: '{query[:50]}...'")

        # Retrieve relevant chunks
        results = await self.retriever.search(query, top_k=top_k)

        if not results:
            logger.warning("[ChatIntegration] No results found, using direct query")
            return query, []

        # Build context string
        context_parts = []
        for i, result in enumerate(results, 1):
            source_info = result.metadata.get("title", "Unknown")
            section = result.metadata.get("section_type", "")
            context_parts.append(f"[{i}. {source_info} - {section}]\n{result.content}")

        context = "\n\n".join(context_parts)

        # Render prompt
        system, user = self.prompt_registry.render(
            "rag_research",
            context=context,
            question=query,
        )

        logger.info(f"[ChatIntegration] Built prompt with {len(results)} sources")
        return user, results

    def format_sources(self, results: List[VectorResult]) -> str:
        """Format sources for display"""
        if not results:
            return "No sources found."

        lines = []
        for i, result in enumerate(results, 1):
            title = result.metadata.get("title", "Unknown")
            section = result.metadata.get("section_type", "")
            score = result.score
            lines.append(f"[{i}] {title} ({section}) - Score: {score:.2f}")

        return "\n".join(lines)
