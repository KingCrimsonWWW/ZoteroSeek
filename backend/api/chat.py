"""
聊天 API 模块 —— 提供 RAG 聊天的 HTTP 接口

这是整个 RAG 系统的入口点，负责：
1. 接收用户的聊天请求
2. 组装 RAG 流水线（检索 → 上下文增强 → LLM 生成）
3. 通过 SSE（Server-Sent Events）流式返回 LLM 的生成结果
4. 在流末尾返回参考文献来源

技术决策：为什么使用 SSE 而非 WebSocket？
- SSE 是单向的（服务器 → 客户端），适合"一问一答"的聊天场景
- SSE 基于 HTTP，天然支持 CORS、代理、负载均衡等基础设施
- 实现简单，FastAPI 原生支持 StreamingResponse
- WebSocket 是双向通信，适合实时协作场景，但对聊天场景来说过于复杂

SSE 协议格式：
- 每条消息以 "data: " 前缀开头，以 "\n\n" 结尾
- 客户端通过 EventSource API 接收
- "data: [DONE]\n\n" 是自定义的结束标记，通知客户端流已结束

模块级单例说明：
embedder、vector_store、prompt_registry、llm_client 在模块加载时创建
（但在实际请求中会调用 initialize()），这是 Python 模块级单例的常见做法。
FastAPI 的路由函数在每次请求时被调用，但这些组件是共享的。
"""

import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from loguru import logger
from backend.core.rag.chat_integration import ChatIntegration
from backend.core.rag.retriever import Retriever
from backend.core.prompts.registry import PromptRegistry
from backend.core.llm.embeddings import EmbeddingClient
from backend.core.llm.client import LLMClient
from backend.data.chroma_store import ChromaVectorStore

router = APIRouter(tags=["chat"])


# 请求模型：使用 Pydantic 进行自动参数校验
# - message: 用户的提问文本
# - top_k: 检索返回的相关文档片段数量，默认 5
class ChatRequest(BaseModel):
    message: str
    top_k: int = 5


# 模块级组件实例（模块单例模式）
# 这些组件在模块加载时创建，所有请求共享同一个实例
embedder = EmbeddingClient()
vector_store = ChromaVectorStore()
prompt_registry = PromptRegistry()
llm_client = LLMClient()


@router.post("/chat")
async def chat(request: ChatRequest):
    """RAG chat with streaming response"""
    try:
        logger.info(f"[Chat] Received request: {request.message}")
        # 确保向量数据库已初始化（幂等操作，多次调用无副作用）
        await vector_store.initialize()

        # 组装 RAG 流水线的各个组件
        # 这里使用组合模式：将 Retriever 和 PromptRegistry 注入 ChatIntegration
        retriever = Retriever(embedder=embedder, vector_store=vector_store)
        chat_integration = ChatIntegration(retriever=retriever, prompt_registry=prompt_registry)

        # ==================== RAG 核心流程 ====================
        # augment_query() 内部完成：
        # 1. 将用户问题向量化
        # 2. 在向量数据库中搜索最相关的 top_k 个文档片段
        # 3. 将片段组装为上下文，填入 Prompt 模板
        # 返回：增强后的 Prompt 文本 + 检索到的来源列表
        augmented_prompt, sources = await chat_integration.augment_query(
            query=request.message,
            top_k=request.top_k,
        )

        # 构建 LLM 消息格式（OpenAI Chat Completion 格式）
        # system message: 设定 LLM 的角色和行为准则
        # user message: 包含 RAG 上下文的增强型提问
        system, _ = prompt_registry.render("rag_research", context="", question="")
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": augmented_prompt},
        ]

        # ==================== 构建参考文献数据 ====================
        # 将检索结果格式化为结构化的 JSON 数据
        # 前端可以在流结束后展示这些来源信息，方便用户查看引用
        sources_data = []
        for i, src in enumerate(sources, 1):
            sources_data.append({
                "index": i,
                "title": src.metadata.get("title", "Unknown"),
                "section": src.metadata.get("section_type", ""),
                "score": round(src.score, 3),
                "content_preview": src.content[:200],  # 只取前 200 字符作为预览
            })

        # ==================== SSE 流式响应 ====================
        # 使用 FastAPI 的 StreamingResponse 实现 Server-Sent Events
        # 为什么用生成器（async generator）？
        # - 生成器是惰性求值的，每产生一个 chunk 就立即发送给客户端
        # - 用户无需等待 LLM 生成完整回答，可以实时看到输出（打字机效果）
        # - 减少了首字节延迟（Time to First Token, TTFT）
        async def generate():
            try:
                # 逐 chunk 流式获取 LLM 的生成结果
                async for chunk in llm_client.chat(messages, stream=True):
                    yield f"data: {chunk}\n\n"
            except Exception as e:
                # 流式传输过程中的错误处理
                # 注意：此时 HTTP 状态码已经发送（200），只能通过 SSE 数据流传递错误
                logger.error(f"[Chat] Stream error: {e}")
                yield f"data: [Error: {str(e)}]\n\n"

            # 在 LLM 输出结束后，发送参考文献来源
            # 使用自定义的 "sources:" 前缀，与 "data:" 区分，方便前端解析
            if sources_data:
                yield f"sources: {json.dumps(sources_data, ensure_ascii=False)}\n\n"
            # 发送结束标记，通知客户端流已完成
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
    except Exception as e:
        # 外层异常处理：捕获非流式的初始化错误（如向量数据库连接失败）
        logger.exception(f"[Chat] Error: {e}")
        raise
