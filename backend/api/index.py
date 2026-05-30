from fastapi import APIRouter
from pydantic import BaseModel
from backend.core.pipeline.interfaces import PipelineContext
from backend.core.pipeline.ingestion import IngestionPipeline
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.chroma_store import ChromaVectorStore
from backend.extractors.pdf import PDFExtractor
from backend.extractors.mineru_extractor import MinerUExtractor
from loguru import logger

router = APIRouter(tags=["index"])


class IndexRequest(BaseModel):
    pdf_path: str
    item_id: str = "manual"
    extractor: str = "mineru"  # "mineru" | "pymupdf"


class IndexResponse(BaseModel):
    success: bool
    item_id: str
    chunks_created: int = 0
    error: str | None = None
    extractor_used: str = ""


# 提取器注册表
EXTRACTORS = {
    "mineru": MinerUExtractor,
    "pymupdf": PDFExtractor,
}

parser = DocumentParser()
chunker = SemanticChunker()
embedder = EmbeddingClient()
vector_store = ChromaVectorStore()


def get_extractor(name: str):
    """根据名称获取提取器实例"""
    cls = EXTRACTORS.get(name)
    if not cls:
        raise ValueError(f"未知提取器: {name}，可选: {list(EXTRACTORS.keys())}")
    return cls()


@router.post("/index", response_model=IndexResponse)
async def index_pdf(request: IndexRequest):
    """索引 PDF 文件，支持选择提取器"""
    try:
        extractor = get_extractor(request.extractor)
        logger.info(f"[Index] 索引 {request.pdf_path}，使用 {request.extractor} 提取器")

        await vector_store.initialize()

        pipeline = IngestionPipeline(
            extractor=extractor,
            parser=parser,
            chunker=chunker,
            embedder=embedder,
            vector_store=vector_store,
        )

        ctx = PipelineContext(
            item_id=request.item_id,
            source_path=request.pdf_path,
        )

        result = await pipeline.ingest(ctx)

        return IndexResponse(
            success=result.success,
            item_id=result.item_id,
            chunks_created=result.chunks_created,
            error=result.error,
            extractor_used=request.extractor,
        )
    except ValueError as e:
        return IndexResponse(
            success=False,
            item_id=request.item_id,
            error=str(e),
        )
    except Exception as e:
        logger.exception(f"[Index] 索引失败: {e}")
        return IndexResponse(
            success=False,
            item_id=request.item_id,
            error=str(e),
        )
