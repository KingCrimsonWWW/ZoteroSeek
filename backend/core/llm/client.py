import httpx
import json
from typing import List, Dict, AsyncGenerator, Optional
from backend.config.settings import settings
from loguru import logger


class LLMClient:
    """OpenAI Compatible LLM Client with streaming support"""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or settings.llm_api_key
        self.base_url = base_url or settings.llm_base_url
        self.model = model or settings.llm_model

    async def chat(
        self, messages: List[Dict[str, str]], stream: bool = True
    ) -> AsyncGenerator[str, None]:
        """Send chat request with streaming response"""
        logger.info(f"[LLM] Chat request, model={self.model}, stream={stream}")

        async with httpx.AsyncClient() as client:
            if stream:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "messages": messages,
                        "stream": True,
                    },
                    timeout=120.0,
                ) as response:
                    response.raise_for_status()

                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        if line.startswith("data: "):
                            data = line[6:]
                            if data.strip() == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                                delta = chunk["choices"][0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield content
                            except (json.JSONDecodeError, IndexError, KeyError):
                                continue
            else:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "messages": messages,
                        "stream": False,
                    },
                    timeout=120.0,
                )
                response.raise_for_status()
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                yield content

    async def chat_sync(
        self, messages: List[Dict[str, str]]
    ) -> str:
        """Send chat request and return complete response"""
        chunks = []
        async for chunk in self.chat(messages, stream=False):
            chunks.append(chunk)
        return "".join(chunks)
