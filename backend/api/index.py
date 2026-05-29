from fastapi import APIRouter
from pydantic import BaseModel
from backend.core.pipeline.interfaces import PipelineContext
from backend.core.pipeline.ingestion import IngestionPipeline
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.chroma_store import ChromaVectorStore
from backend.extractors.pdf import PDFExtractor
from backend.config.settings import settings

router = APIRouter(tags=["index"])

class IndexRequest(BaseModel):
    pdf_path: str
    item_id: str = "manual"

class IndexResponse(BaseModel):
    success: bool
    item_id: str
    chunks_created: int = 0
    error: str | None = None

# Initialize pipeline
extractor = PDFExtractor()
parser = DocumentParser()
chunker = SemanticChunker()
embedder = EmbeddingClient()
vector_store = ChromaVectorStore()

@router.post("/index", response_model=IndexResponse)
async def index_pdf(request: IndexRequest):
    """Index a PDF file"""
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
    )
