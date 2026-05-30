from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from backend.models.document import SectionType

class ChunkMetadata(BaseModel):
    """Chunk metadata for retrieval and reranking"""
    item_id: str
    title: str
    authors: List[str] = ["Unknown"]
    year: Optional[int] = None
    section_type: str = "unknown"
    heading_path: List[str] = []
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    citation_refs: List[str] = ["None"]
    content_hash: str = ""

class Chunk(BaseModel):
    """Document chunk with embedding"""
    id: str
    content: str
    metadata: ChunkMetadata
    embedding: Optional[List[float]] = None
