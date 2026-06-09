"""
聊天 API — 使用 LangGraph ReAct Agent

改造前：手写 RAG 流程（Retriever → PromptRegistry → LLMClient）
改造后：LangGraph Agent 自主决定是否使用工具（search/query_library/index）

SSE 协议不变：
- data: {chunk}\n\n — LLM 输出的每个 token
- sources: {json}\n\n — 引用来源
- data: [DONE]\n\n — 流结束标记
"""

import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from loguru import logger
from backend.agent.graph import get_agent

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    top_k: int = 5


@router.post("/chat")
async def chat(request: ChatRequest):
    """RAG Agent Chat — SSE 流式响应"""
    try:
        logger.info(f"[Chat] Received: {request.message[:80]}")
        agent = get_agent()

        async def generate():
            sources = []
            try:
                # astream_events 是 LangGraph 的流式 API
                # version="v2" 是推荐的事件格式版本
                async for event in agent.astream_events(
                    {"messages": [("human", request.message)]},
                    version="v2",
                ):
                    kind = event.get("event", "")

                    # LLM 生成的 token → 发送给前端
                    if kind == "on_chat_model_stream":
                        chunk = event.get("data", {}).get("chunk")
                        if chunk and chunk.content:
                            yield f"data: {chunk.content}\n\n"

                    # 工具调用结果 → 收集为 sources
                    elif kind == "on_tool_end":
                        tool_name = event.get("name", "")
                        tool_output = event.get("data", {}).get("output", "")
                        if tool_name == "search_knowledge" and tool_output:
                            sources.append({
                                "tool": tool_name,
                                "output_preview": tool_output[:300],
                            })

            except Exception as e:
                logger.error(f"[Chat] Stream error: {e}")
                yield f"data: [Error: {str(e)}]\n\n"

            # 发送引用来源
            if sources:
                yield f"sources: {json.dumps(sources, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    except Exception as e:
        logger.exception(f"[Chat] Error: {e}")
        raise
