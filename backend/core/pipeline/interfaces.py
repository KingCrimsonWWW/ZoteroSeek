from pydantic import BaseModel
from typing import Optional

class PipelineContext(BaseModel):
    """Context for pipeline execution"""
    item_id: str
    source_path: str
    content_hash: str = ""

class PipelineResult(BaseModel):
    """Result of pipeline execution"""
    success: bool
    item_id: str
    chunks_created: int = 0
    error: Optional[str] = None
    duration_ms: float = 0
