from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.core.rag.chat_integration import ChatIntegration
from backend.core.rag.retriever import Retriever
from backend.core.prompts.registry import PromptRegistry
from backend.core.llm.embeddings import EmbeddingClient
from backend.core.llm.client import LLMClient
from backend.data.chroma_store import ChromaVectorStore

router = APIRouter(tags=["chat"])

class ChatRequest(BaseModel):
    message: str
    top_k: int = 5

embedder = EmbeddingClient()
vector_store = ChromaVectorStore()
prompt_registry = PromptRegistry()
llm_client = LLMClient()

@router.post("/chat")
async def chat(request: ChatRequest):
    """RAG chat with streaming response"""
    await vector_store.initialize()
    retriever = Retriever(embedder=embedder, vector_store=vector_store)
    chat_integration = ChatIntegration(retriever=retriever, prompt_registry=prompt_registry)

    # Get augmented prompt with RAG context
    augmented_prompt, sources = await chat_integration.augment_query(
        query=request.message,
        top_k=request.top_k,
    )

    # Build messages
    system, _ = prompt_registry.render("rag_research", context="", question="")
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": augmented_prompt},
    ]

    # Stream response
    async def generate():
        async for chunk in llm_client.chat(messages, stream=True):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
