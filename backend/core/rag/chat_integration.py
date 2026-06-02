"""
RAG 聊天集成模块 —— 负责检索增强生成（Retrieval-Augmented Generation）的核心逻辑

什么是 RAG？
RAG 是一种将"信息检索"与"语言生成"结合的技术范式：
1. 用户提问 → 2. 从知识库中检索相关文档片段 → 3. 将片段作为上下文注入 Prompt → 4. LLM 基于上下文生成回答

为什么需要 RAG？
- LLM 的训练数据有截止日期，无法回答关于最新研究的问题
- LLM 可能产生"幻觉"（编造不存在的论文引用）
- RAG 通过提供真实的文档片段作为依据，大幅提高回答的准确性和可追溯性

本模块的设计思路：
- ChatIntegration 是 RAG 流程的编排器，协调 Retriever 和 PromptRegistry
- augment_query() 是核心方法：检索 → 组装上下文 → 渲染 Prompt
- format_sources() 是辅助方法：将检索结果格式化为用户可读的引用列表

依赖关系：
    Retriever（检索器） → 从向量数据库中搜索相关 Chunk
    PromptRegistry（提示词注册表） → 管理和渲染 Prompt 模板
"""

from typing import List, Tuple
from backend.core.rag.retriever import Retriever
from backend.core.prompts.registry import PromptRegistry
from backend.data.vector_store import VectorResult
from loguru import logger


class ChatIntegration:
    """RAG chat integration - retrieves context and builds prompts"""

    # 依赖注入：检索器和提示词注册表通过构造函数注入
    # 这使得 ChatIntegration 不直接依赖具体的检索实现或 Prompt 格式
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

        # ==================== 阶段 1：检索（Retrieval）====================
        # 将用户的问题转换为向量，在向量数据库中搜索最相关的 top_k 个文档片段
        # Retriever 内部会调用 EmbeddingClient 将查询文本向量化，然后调用 VectorStore 进行相似性搜索
        results = await self.retriever.search(query, top_k=top_k)

        # 如果没有检索到任何结果，直接返回原始查询（退化为普通聊天，不注入上下文）
        if not results:
            logger.warning("[ChatIntegration] No results found, using direct query")
            return query, []

        # ==================== 阶段 2：上下文组装（Context Assembly）====================
        # 将检索到的文档片段格式化为结构化的上下文字符串
        # 每个片段都标注了来源信息（标题 + 章节类型），方便 LLM 引用和用户溯源
        # 编号 [1], [2], ... 使得 LLM 可以在回答中标注引用来源
        context_parts = []
        for i, result in enumerate(results, 1):
            source_info = result.metadata.get("title", "Unknown")
            section = result.metadata.get("section_type", "")
            context_parts.append(f"[{i}. {source_info} - {section}]\n{result.content}")

        context = "\n\n".join(context_parts)

        # ==================== 阶段 3：Prompt 渲染（Prompt Rendering）====================
        # 使用 PromptRegistry 中的 "rag_research" 模板，将上下文和问题填入模板
        # 返回 system prompt 和 user prompt 两部分
        # system prompt 通常包含角色设定和行为准则（如"请基于以下学术文献回答"）
        # user prompt 包含实际的上下文和用户问题
        system, user = self.prompt_registry.render(
            "rag_research",
            context=context,
            question=query,
        )

        logger.info(f"[ChatIntegration] Built prompt with {len(results)} sources")
        return user, results

    def format_sources(self, results: List[VectorResult]) -> str:
        """格式化检索来源为可读的引用列表

        输出示例：
            [1] Attention Is All You Need (abstract) - Score: 0.92
            [2] BERT: Pre-training of Deep Bidirectional Transformers (introduction) - Score: 0.87

        用途：
        - 在聊天界面中展示参考文献，让用户知道回答基于哪些文献
        - score 值反映检索的相关性程度，帮助用户判断可信度
        """
        if not results:
            return "No sources found."

        lines = []
        for i, result in enumerate(results, 1):
            title = result.metadata.get("title", "Unknown")
            section = result.metadata.get("section_type", "")
            score = result.score
            lines.append(f"[{i}] {title} ({section}) - Score: {score:.2f}")

        return "\n".join(lines)
