"""
MinerU PDF Extractor — 通过 MinerU Agent 轻量解析 API 将 PDF 转换为结构化 Markdown

API 调用流程（4 步异步交互）：
1. POST /api/v1/agent/parse/file → 提交解析任务，返回 task_id + file_url（OSS 预签名上传地址）
2. PUT file_url → 将 PDF 文件上传到对象存储（OSS）
3. GET /api/v1/agent/parse/{task_id} → 轮询任务状态，直到 state=done，获取 markdown_url
4. GET markdown_url → 从 CDN 下载解析后的 Markdown 内容

为什么选择 MinerU 而非本地解析（如 PyMuPDF）？
1. MinerU 使用深度学习模型进行版面分析，能准确识别：
   - 标题层级（H1、H2、H3...）
   - 表格结构（保留行列关系）
   - 数学公式（转换为 LaTeX）
   - 图片描述
   - 页眉页脚（自动过滤）
2. 本地解析库（如 PyMuPDF）只能提取纯文本，丢失所有结构化信息
3. 对于学术论文，结构化信息对后续的语义分块和检索质量至关重要

限制条件：
- 文件大小：≤ 10MB
- 页数：≤ 20 页
- 无需 Token 认证（IP 限频），但也支持 API Key 认证以获得更高配额

设计模式：模板方法模式（Template Method）
- extract() 定义了固定的 4 步流程骨架
- 每一步由独立的私有方法实现（_submit_task、_upload_file、_poll_result、_download_markdown）
- 如果 API 流程变化，只需修改对应的方法，不影响整体流程

错误处理策略：
- 每个步骤都有明确的错误检查和异常消息
- 文件大小预检查，避免不必要的 API 调用
- 轮询超时保护（默认 120 秒），防止无限等待
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

# API 限制常量
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB，API 的硬性限制
MAX_PAGES = 20                     # 最多处理前 20 页


class MinerUExtractor(Extractor):
    """PDF 解析器，使用 MinerU Agent 轻量解析 API（免 Token）"""

    def __init__(self):
        # 优先使用配置文件中的自定义 URL，便于开发/测试环境切换
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

        # 预检查：文件大小限制
        # 在发起网络请求前就检查，避免浪费带宽和时间
        file_size = source_path.stat().st_size
        if file_size > MAX_FILE_SIZE:
            raise ValueError(
                f"PDF 文件过大（{file_size / 1024 / 1024:.1f}MB），"
                f"Agent 轻量解析限制 {MAX_FILE_SIZE / 1024 / 1024:.0f}MB。"
                f"请使用 pymupdf 提取器。"
            )

        pdf_bytes = source_path.read_bytes()
        logger.info(f"[MinerU] 开始解析: {source_path.name} ({file_size / 1024:.0f}KB)")

        # HTTP 客户端配置：
        # - connect=30s: 连接超时，防止网络不通时长时间阻塞
        # - read=120s: 读取超时，PDF 上传/下载可能较慢
        # - follow_redirects=True: OSS 上传地址可能涉及重定向
        timeout = httpx.Timeout(connect=30, read=120, write=120, pool=30)
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        # 使用 async with 确保 HTTP 连接在使用后正确关闭
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            # ==================== 步骤 1：提交解析任务 ====================
            # 向 MinerU API 发送文件名和配置，获取任务 ID 和 OSS 上传地址
            # API 返回的 upload_url 是一个预签名 URL，可直接 PUT 上传文件
            task_id, upload_url = await self._submit_task(client, source_path.name, headers)
            logger.info(f"[MinerU] 任务已提交: {task_id}")

            # ==================== 步骤 2：上传 PDF 到 OSS ====================
            # 将 PDF 文件的原始字节通过 HTTP PUT 上传到对象存储
            # 这个 URL 是预签名的，无需额外认证
            await self._upload_file(client, upload_url, pdf_bytes)
            logger.info(f"[MinerU] 文件已上传")

            # ==================== 步骤 3：轮询解析结果 ====================
            # MinerU API 是异步处理的，需要定期查询任务状态
            # 当 state 变为 "done" 时，获取生成的 Markdown 文件 URL
            markdown_url = await self._poll_result(client, task_id, headers)
            logger.info(f"[MinerU] 解析完成，下载 Markdown...")

            # ==================== 步骤 4：下载 Markdown ====================
            # 从 CDN 下载解析后的 Markdown 内容
            markdown = await self._download_markdown(client, markdown_url, headers)
            logger.info(f"[MinerU] 获取到 {len(markdown)} 字符 Markdown")

            # 返回标准化的 RawContent，供下游流水线使用
            return RawContent(
                content=markdown,
                content_type="markdown",
                page_count=0,  # Agent API 不返回页数信息
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
        """提交解析任务，返回 (task_id, upload_url)

        请求体说明：
        - file_name: 文件名（非文件内容），仅用于任务标识
        - language: 文档语言，影响 OCR 和分词策略
        - page_range: 限制处理的页数范围，避免超出 API 限制
        """
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

        # API 约定：code == 0 表示成功，非 0 表示错误
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
        """上传 PDF 文件到 OSS 预签名 URL

        预签名 URL 的特点：
        - URL 中包含了临时的认证信息，无需额外的 Authorization header
        - 有时间限制，过期后无法使用
        - 使用 PUT 方法直接上传原始字节
        """
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
        """轮询任务结果，返回 markdown_url

        轮询策略：
        - 每隔 poll_interval（默认 3 秒）查询一次任务状态
        - 最多等待 max_wait（默认 120 秒）
        - 状态机：
          - "done": 任务完成，返回 markdown_url
          - "failed"/"error": 任务失败，抛出异常
          - 其他状态（如 "pending"/"processing"）：继续等待

        为什么不使用 WebSocket 或 Webhook？
        - MinerU API 只提供轮询接口
        - 轮询虽然简单，但对轻量级任务（< 2 分钟）足够高效
        - poll_interval=3 秒是平衡"响应速度"和"API 调用频率"的折中值
        """
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
                # 提取详细的错误信息，帮助用户定位问题
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
        """从 CDN 下载 MinerU 解析生成的 Markdown 内容

        CDN URL 的特点：
        - 通常有时效性，需要在获取后尽快下载
        - 返回的是纯文本 Markdown，Content-Type 为 text/markdown
        """
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        return response.text

    def supports(self, source_type: str) -> bool:
        """当前提取器仅支持 PDF 格式"""
        return source_type.lower() == "pdf"
