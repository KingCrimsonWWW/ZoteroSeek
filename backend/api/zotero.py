"""
Zotero 集成 API — 从 Zotero 本地库发现文献并批量索引 PDF

端点：
- GET  /api/v1/zotero-items    — 列出 Zotero 库中的文献（含 PDF 附件信息）
- POST /api/v1/index-zotero    — 批量索引 Zotero 库中的 PDF
"""

import asyncio
import json
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from loguru import logger

from backend.config.settings import settings
from backend.core.pipeline.interfaces import PipelineContext
from backend.core.pipeline.ingestion import IngestionPipeline
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.chroma_store import ChromaVectorStore
from backend.data.db import SessionLocal
from backend.data.models import Item
from backend.extractors.mineru_extractor import MinerUExtractor
from backend.extractors.pdf import PDFExtractor

router = APIRouter(tags=["zotero"])

# 提取器注册表（与 index.py 保持一致）
EXTRACTORS = {
    "mineru": MinerUExtractor,
    "pymupdf": PDFExtractor,
}

# Zotero 本地存储路径（PDF 附件存放位置）
# 从 settings 读取，留空则使用默认路径
def _get_zotero_storage_base() -> Path:
    if settings.zotero_storage_path:
        return Path(settings.zotero_storage_path)
    return Path.home() / "Zotero" / "storage"

ZOTERO_STORAGE_BASE = _get_zotero_storage_base()


# ── 响应模型 ──────────────────────────────────────────────────

class ZoteroAttachment(BaseModel):
    key: str
    filename: str
    path: str  # 本地文件路径
    parent_key: str
    content_type: str


class ZoteroItem(BaseModel):
    key: str
    title: str
    item_type: str
    authors: List[str]
    date: str
    abstract: str
    doi: str
    attachments: List[ZoteroAttachment]
    indexed: bool  # 是否已在 ZoteroSeek 中索引


class ZoteroItemsResponse(BaseModel):
    items: List[ZoteroItem]
    total: int
    pdf_count: int
    zotero_connected: bool = True


class IndexZoteroRequest(BaseModel):
    item_keys: Optional[List[str]] = None  # 为空 = 索引全部
    extractor: str = "mineru"


class IndexZoteroResponse(BaseModel):
    total: int
    success: int
    failed: int
    skipped: int
    results: list


# ── Zotero API 客户端 ──────────────────────────────────────────

async def fetch_zotero_items(
    client: httpx.AsyncClient,
    limit: int = 100,
    item_type: str = "-attachment -note",
) -> list:
    """从 Zotero 本地 API 获取文献列表"""
    url = f"{settings.zotero_api_url}/users/0/items"
    headers = {}
    if settings.zotero_api_key:
        headers["Zotero-API-Key"] = settings.zotero_api_key

    all_items = []
    start = 0
    while True:
        resp = await client.get(
            url,
            params={"limit": limit, "start": start, "itemType": item_type},
            headers=headers,
        )
        resp.raise_for_status()
        items = resp.json()
        if not items:
            break
        all_items.extend(items)
        if len(items) < limit:
            break
        start += limit

    return all_items


async def fetch_zotero_attachments(
    client: httpx.AsyncClient,
    limit: int = 100,
) -> list:
    """获取所有 PDF 附件（分页）"""
    url = f"{settings.zotero_api_url}/users/0/items"
    headers = {}
    if settings.zotero_api_key:
        headers["Zotero-API-Key"] = settings.zotero_api_key

    all_items = []
    start = 0
    while True:
        resp = await client.get(
            url,
            params={"limit": limit, "start": start, "itemType": "attachment"},
            headers=headers,
        )
        resp.raise_for_status()
        items = resp.json()
        if not items:
            break
        all_items.extend(items)
        if len(items) < limit:
            break
        start += limit

    return all_items


def resolve_pdf_path(attachment_data: dict) -> Optional[Path]:
    """从 Zotero attachment 数据解析本地 PDF 路径（仅 PDF，过滤 snapshot/html）"""
    key = attachment_data.get("key", "")
    filename = attachment_data.get("filename", "")
    content_type = attachment_data.get("contentType", "")
    link_mode = attachment_data.get("linkMode", "")

    # 只接受 PDF 附件，跳过 snapshot、html、linked_url 等
    if content_type != "application/pdf" and not filename.lower().endswith(".pdf"):
        return None
    # 额外过滤：跳过 imported_url（通常是网页 snapshot）
    if link_mode == "imported_url" and content_type != "application/pdf":
        return None

    pdf_path = ZOTERO_STORAGE_BASE / key / filename
    if pdf_path.exists():
        return pdf_path
    return None


def get_indexed_item_ids() -> set:
    """从 SQLite 获取已索引的 item_id 集合"""
    db = SessionLocal()
    try:
        items = db.query(Item.id).all()
        return {item.id for item in items}
    except Exception:
        return set()
    finally:
        db.close()


# ── API 端点 ──────────────────────────────────────────────────

@router.get("/zotero-items", response_model=ZoteroItemsResponse)
async def list_zotero_items():
    """列出 Zotero 库中的所有文献及其 PDF 附件"""
    timeout = httpx.Timeout(connect=10, read=30, write=10, pool=10)
    indexed_ids = get_indexed_item_ids()

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            raw_items = await fetch_zotero_items(client)
            raw_attachments = await fetch_zotero_attachments(client)
    except httpx.ConnectError:
        return ZoteroItemsResponse(items=[], total=0, pdf_count=0, zotero_connected=False)
    except httpx.HTTPStatusError as e:
        logger.error(f"[Zotero] API 错误: {e}")
        return ZoteroItemsResponse(items=[], total=0, pdf_count=0, zotero_connected=False)
    except Exception as e:
        logger.error(f"[Zotero] 连接失败: {e}")
        return ZoteroItemsResponse(items=[], total=0, pdf_count=0, zotero_connected=False)

    # 构建 parent_key → attachments 映射
    attachment_map: dict[str, list[ZoteroAttachment]] = {}
    pdf_count = 0

    for att in raw_attachments:
        att_data = att.get("data", {})
        parent_key = att_data.get("parentItem", "")
        if not parent_key:
            continue

        pdf_path = resolve_pdf_path(att_data)
        if pdf_path is None:
            continue

        att_obj = ZoteroAttachment(
            key=att_data["key"],
            filename=att_data.get("filename", ""),
            path=str(pdf_path),
            parent_key=parent_key,
            content_type=att_data.get("contentType", ""),
        )
        attachment_map.setdefault(parent_key, []).append(att_obj)
        pdf_count += 1

    # 组装 ZoteroItem 列表
    items: List[ZoteroItem] = []
    for raw in raw_items:
        data = raw.get("data", {})
        key = data.get("key", "")

        # 提取作者
        creators = data.get("creators", [])
        authors = []
        for c in creators:
            name = c.get("name", "")
            if not name:
                last = c.get("lastName", "")
                first = c.get("firstName", "")
                name = f"{last} {first}".strip()
            if name:
                authors.append(name)

        attachments = attachment_map.get(key, [])
        has_indexed_pdf = any(
            f"{a.parent_key}_{Path(a.path).stem}" in indexed_ids or a.parent_key in indexed_ids
            for a in attachments
        )

        items.append(ZoteroItem(
            key=key,
            title=data.get("title", ""),
            item_type=data.get("itemType", ""),
            authors=authors,
            date=data.get("date", ""),
            abstract=data.get("abstractNote", "")[:300],
            doi=data.get("DOI", ""),
            attachments=attachments,
            indexed=has_indexed_pdf,
        ))

    return ZoteroItemsResponse(items=items, total=len(items), pdf_count=pdf_count)


@router.post("/index-zotero", response_model=IndexZoteroResponse)
async def index_zotero(request: IndexZoteroRequest):
    """批量索引 Zotero 库中的 PDF"""
    extractor_cls = EXTRACTORS.get(request.extractor)
    if not extractor_cls:
        return IndexZoteroResponse(
            total=0, success=0, failed=0, skipped=1,
            results=[{"error": f"未知提取器: {request.extractor}"}],
        )

    extractor = extractor_cls()
    parser = DocumentParser()
    chunker = SemanticChunker()
    embedder = EmbeddingClient()
    vector_store = ChromaVectorStore()

    timeout = httpx.Timeout(connect=10, read=30, write=10, pool=10)
    indexed_ids = get_indexed_item_ids()

    async with httpx.AsyncClient(timeout=timeout) as client:
        raw_items = await fetch_zotero_items(client)
        raw_attachments = await fetch_zotero_attachments(client)

    # 构建 item_key → item_data 映射
    item_map = {item["data"]["key"]: item["data"] for item in raw_items}

    # 筛选要索引的 PDF
    targets = []
    for att in raw_attachments:
        att_data = att.get("data", {})
        parent_key = att_data.get("parentItem", "")
        pdf_path = resolve_pdf_path(att_data)
        if pdf_path is None:
            continue
        if request.item_keys and parent_key not in request.item_keys:
            continue
        if parent_key in indexed_ids:
            continue  # 已索引，跳过
        targets.append((parent_key, pdf_path, att_data))

    logger.info(f"[Zotero] 待索引 {len(targets)} 个 PDF")

    # 逐个索引
    await vector_store.initialize()
    pipeline = IngestionPipeline(
        extractor=extractor,
        parser=parser,
        chunker=chunker,
        embedder=embedder,
        vector_store=vector_store,
    )

    success, failed, skipped = 0, 0, 0
    results = []

    for parent_key, pdf_path, att_data in targets:
        item_data = item_map.get(parent_key, {})
        title = item_data.get("title", pdf_path.stem)

        try:
            logger.info(f"[Zotero] 索引: {title}")

            ctx = PipelineContext(
                item_id=parent_key,
                source_path=str(pdf_path),
            )
            result = await pipeline.ingest(ctx)

            if result.success:
                # 保存到 SQLite
                db = SessionLocal()
                try:
                    creators = item_data.get("creators", [])
                    authors = []
                    for c in creators:
                        name = c.get("name", "")
                        if not name:
                            name = f"{c.get('lastName', '')} {c.get('firstName', '')}".strip()
                        if name:
                            authors.append(name)

                    item = Item(
                        id=parent_key,
                        title=title,
                        authors=json.dumps(authors, ensure_ascii=False),
                        year=_extract_year(item_data.get("date", "")),
                        abstract=item_data.get("abstractNote", "")[:500],
                        pdf_path=str(pdf_path),
                        index_status="indexed",
                    )
                    db.merge(item)
                    db.commit()
                except Exception as e:
                    logger.warning(f"[Zotero] SQLite 写入失败: {e}")
                finally:
                    db.close()

                success += 1
                results.append({
                    "key": parent_key,
                    "title": title,
                    "success": True,
                    "chunks": result.chunks_created,
                })
            else:
                failed += 1
                results.append({
                    "key": parent_key,
                    "title": title,
                    "success": False,
                    "error": result.error,
                })

        except Exception as e:
            logger.error(f"[Zotero] 索引失败 {title}: {e}")
            failed += 1
            results.append({
                "key": parent_key,
                "title": title,
                "success": False,
                "error": str(e),
            })

    logger.info(f"[Zotero] 批量索引完成: {success} 成功, {failed} 失败")

    return IndexZoteroResponse(
        total=len(targets),
        success=success,
        failed=failed,
        skipped=skipped,
        results=results,
    )


def _extract_year(date_str: str) -> Optional[int]:
    """从日期字符串提取年份"""
    if not date_str:
        return None
    try:
        # 尝试解析 "2018-07-03" 或 "2018" 格式
        year = int(date_str[:4])
        if 1900 <= year <= 2100:
            return year
    except (ValueError, IndexError):
        pass
    return None
