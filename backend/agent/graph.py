"""
LangGraph ReAct Agent 图定义

使用 LangGraph 的 create_react_agent 构建一个 ReAct（Reasoning + Acting）Agent：
1. 用户提问 → LLM 思考是否需要工具
2. 如果需要 → 调用工具 → 获取结果 → 继续思考
3. 如果不需要 → 直接回答
4. 循环直到 LLM 给出最终回答

这就是"Agent"与"普通 RAG"的核心区别：
- 普通 RAG：每次提问都检索 → 固定流程
- Agent：LLM 自主决定是否检索、检索什么、是否需要多次检索

依赖组件通过 shared_deps 获取，不在模块内创建。
"""

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from backend.config.settings import settings
from backend.agent.tools import search_knowledge, query_library, index_document
from loguru import logger

# Agent 系统提示词
AGENT_SYSTEM_PROMPT = """You are ZoteroSeek, an AI research assistant specializing in academic papers.

Your capabilities:
1. Search the knowledge base for relevant paper content (search_knowledge)
2. List indexed papers (query_library)
3. Index new PDF papers (index_document)

Rules:
- ALWAYS respond in the SAME LANGUAGE as the user's question. Chinese → Chinese. English → English.
- When the user asks about paper content, research methods, or academic concepts, use search_knowledge FIRST.
- When the user asks "what papers do I have" or similar, use query_library.
- Only cite sources [^N^] when you actually retrieved relevant content from the knowledge base.
- If no relevant context is found, answer naturally without forcing citations.
- Be precise, concise, and helpful."""

# 模块级 Agent 实例（延迟初始化）
_agent = None


def get_agent():
    """
    获取或创建 Agent 实例（单例模式）。

    为什么延迟初始化？
    - settings 在模块导入时可能还未加载完毕
    - ChatOpenAI 需要 api_key 等配置
    """
    global _agent
    if _agent is None:
        llm = ChatOpenAI(
            api_key=settings.llm_api_key or "dummy",  # 兼容无 key 场景
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            streaming=True,
            temperature=0.7,
        )
        tools = [search_knowledge, query_library, index_document]

        _agent = create_react_agent(
            llm,
            tools,
            prompt=AGENT_SYSTEM_PROMPT,
        )
        logger.info(f"[Agent] ReAct Agent created: model={settings.llm_model}")

    return _agent
