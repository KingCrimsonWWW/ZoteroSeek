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
from backend.api.shared_deps import embedder, vector_store, prompt_registry, llm_client, ensure_vector_store

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    top_k: int = 5


@router.post("/chat")
async def chat(request: ChatRequest):
    """RAG chat with streaming response"""
    try:
        logger.info(f"[Chat] Received request: {request.message}")
        await ensure_vector_store()

        retriever = Retriever(embedder=embedder, vector_store=vector_store)
        chat_integration = ChatIntegration(retriever=retriever, prompt_registry=prompt_registry)

        augmented_prompt, sources = await chat_integration.augment_query(
            query=request.message,
            top_k=request.top_k,
        )

        system, _ = prompt_registry.render("rag_research", context="", question="")
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": augmented_prompt},
        ]

        sources_data = []
        for i, src in enumerate(sources, 1):
            sources_data.append({
                "index": i,
                "title": src.metadata.get("title", "Unknown"),
                "section": src.metadata.get("section_type", ""),
                "score": round(src.score, 3),
                "content_preview": src.content[:200],
            })

        async def generate():
            try:
                async for chunk in llm_client.chat(messages, stream=True):
                    yield f"data: {chunk}\n\n"
            except Exception as e:
                logger.error(f"[Chat] Stream error: {e}")
                yield f"data: [Error: {str(e)}]\n\n"

            if sources_data:
                yield f"sources: {json.dumps(sources_data, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
    except Exception as e:
        logger.exception(f"[Chat] Error: {e}")
        raise
