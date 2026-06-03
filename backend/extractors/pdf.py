import asyncio
import fitz  # PyMuPDF
from typing import Dict, Any
from backend.extractors.base import Extractor, RawContent
from loguru import logger

class PDFExtractor(Extractor):
    """PDF text extraction using PyMuPDF"""

    async def extract(self, source: str, config: Dict[str, Any] = None) -> RawContent:
        """
        提取 PDF 文本。

        注意：fitz.open / page.get_text 是同步阻塞调用，必须用
        asyncio.to_thread() 包裹，否则会阻塞 FastAPI 事件循环，
        导致其他并发请求卡住。
        """
        logger.info(f"[PDF] Extracting: {source}")

        # 将阻塞调用放到线程池中执行
        full_text, page_count = await asyncio.to_thread(
            self._extract_sync, source
        )

        logger.info(f"[PDF] Extracted {page_count} pages, {len(full_text)} chars")

        return RawContent(
            content=full_text,
            content_type="pdf",
            page_count=page_count,
            source_path=source,
            metadata={"pages": page_count},
        )

    @staticmethod
    def _extract_sync(source: str) -> tuple[str, int]:
        """同步提取 PDF 文本（在线程池中运行）"""
        doc = fitz.open(source)
        pages = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                pages.append(text)
        doc.close()
        return "\n\n".join(pages), len(pages)

    def supports(self, source_type: str) -> bool:
        return source_type.lower() == "pdf"
