"""
MinerU PDF Extractor — 通过 MinerU Agent 轻量解析 API

流程：
1. POST /api/v1/agent/parse/file → 返回 task_id + file_url（OSS 上传地址）
2. PUT file_url 上传 PDF 文件
3. GET /api/v1/agent/parse/{task_id} → 轮询直到 state=done，返回 markdown_url
4. GET markdown_url → 下载 Markdown 内容

限制：≤ 10MB，≤ 20 页，无需 Token（IP 限频）
"""

import asyncio
from pathlib import Path
from typing import Dict, Any

import httpx
from loguru import logger

from backend.extractors.base import Extractor, RawContent
from backend.config.settings import settings

# Agent 轻量解析 API 配置
DEFAULT_AGENT_BASE_URL = "https://mineru.net"
AGENT_SUBMIT_ENDPOINT = "/api/v1/agent/parse/file"
AGENT_POLL_PREFIX = "/api/v1/agent/parse"

# 限制
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_PAGES = 20


class MinerUExtractor(Extractor):
    """PDF 解析器，使用 MinerU Agent 轻量解析 API（免 Token）"""

    def __init__(self):
        self.base_url = (
            settings.mineru_api_url.rstrip("/")
            if settings.mineru_api_url
            else DEFAULT_AGENT_BASE_URL
        )
        self.api_key = settings.mineru_api_key
        self.language = settings.mineru_language

    async def extract(self, source: str, config: Dict[str, Any] = None) -> RawContent:
        """通过 MinerU Agent API 解析 PDF，返回结构化 Markdown"""
        source_path = Path(source)
        if not source_path.exists():
            raise FileNotFoundError(f"PDF 文件不存在: {source}")

        # 文件大小检查
        file_size = source_path.stat().st_size
        if file_size > MAX_FILE_SIZE:
            raise ValueError(
                f"PDF 文件过大（{file_size / 1024 / 1024:.1f}MB），"
                f"Agent 轻量解析限制 {MAX_FILE_SIZE / 1024 / 1024:.0f}MB。"
                f"请使用 pymupdf 提取器。"
            )

        pdf_bytes = source_path.read_bytes()
        logger.info(f"[MinerU] 开始解析: {source_path.name} ({file_size / 1024:.0f}KB)")

        timeout = httpx.Timeout(connect=30, read=120, write=120, pool=30)
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            # Step 1: 提交任务 → 获取 task_id + OSS 上传地址
            task_id, upload_url = await self._submit_task(client, source_path.name, headers)
            logger.info(f"[MinerU] 任务已提交: {task_id}")

            # Step 2: 上传 PDF 到 OSS
            await self._upload_file(client, upload_url, pdf_bytes)
            logger.info(f"[MinerU] 文件已上传")

            # Step 3: 轮询结果 → 获取 markdown_url
            markdown_url = await self._poll_result(client, task_id, headers)
            logger.info(f"[MinerU] 解析完成，下载 Markdown...")

            # Step 4: 下载 Markdown 内容
            markdown = await self._download_markdown(client, markdown_url, headers)
            logger.info(f"[MinerU] 获取到 {len(markdown)} 字符 Markdown")

            return RawContent(
                content=markdown,
                content_type="markdown",
                page_count=0,
                source_path=source,
                metadata={
                    "extractor": "mineru",
                    "api": "agent-lightweight",
                    "file_size": file_size,
                    "markdown_url": markdown_url,
                },
            )

    async def _submit_task(
        self, client: httpx.AsyncClient, file_name: str, headers: dict,
    ) -> tuple[str, str]:
        """提交解析任务，返回 (task_id, upload_url)"""
        url = f"{self.base_url}{AGENT_SUBMIT_ENDPOINT}"

        # page_range 限制前 20 页（Agent API 上限）
        payload = {
            "file_name": file_name,
            "language": self.language,
            "page_range": f"1-{MAX_PAGES}",
        }

        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        result = response.json()

        if result.get("code") != 0:
            raise RuntimeError(f"MinerU API 错误: {result.get('msg', result)}")

        data = result.get("data", {})
        task_id = data.get("task_id")
        upload_url = data.get("file_url")

        if not task_id or not upload_url:
            raise ValueError(f"MinerU API 响应缺少 task_id 或 file_url: {result}")

        return task_id, upload_url

    async def _upload_file(
        self, client: httpx.AsyncClient, upload_url: str, pdf_bytes: bytes,
    ) -> None:
        """上传 PDF 文件到 OSS 预签名 URL"""
        response = await client.put(upload_url, content=pdf_bytes)
        if response.status_code != 200:
            raise RuntimeError(
                f"文件上传失败: HTTP {response.status_code} {response.text[:200]}"
            )

    async def _poll_result(
        self, client: httpx.AsyncClient, task_id: str, headers: dict,
        poll_interval: float = 3.0,
        max_wait: float = 120.0,
    ) -> str:
        """轮询任务结果，返回 markdown_url"""
        url = f"{self.base_url}{AGENT_POLL_PREFIX}/{task_id}"
        elapsed = 0.0

        while elapsed < max_wait:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            if data.get("code") != 0:
                raise RuntimeError(f"MinerU API 错误: {data.get('msg', data)}")

            state = data.get("data", {}).get("state", "")

            if state == "done":
                markdown_url = data["data"].get("markdown_url")
                if not markdown_url:
                    raise ValueError(f"任务完成但未返回 markdown_url: {data}")
                return markdown_url

            elif state in ("failed", "error"):
                error = (
                    data.get("data", {}).get("err_msg")
                    or data.get("data", {}).get("error")
                    or "未知错误"
                )
                err_code = data.get("data", {}).get("err_code", "")
                raise RuntimeError(f"MinerU 解析失败 [{err_code}]: {error}")

            else:
                logger.debug(f"[MinerU] 任务状态: {state}")

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(f"MinerU 任务超时（{max_wait}s）: {task_id}")

    async def _download_markdown(
        self, client: httpx.AsyncClient, url: str, headers: dict,
    ) -> str:
        """从 CDN 下载 Markdown 内容"""
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        return response.text

    def supports(self, source_type: str) -> bool:
        return source_type.lower() == "pdf"
