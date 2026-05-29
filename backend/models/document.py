from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from enum import Enum

class SectionType(str, Enum):
    """Academic paper section types"""
    ABSTRACT = "abstract"
    INTRODUCTION = "introduction"
    RELATED_WORK = "related_work"
    METHODS = "methods"
    EXPERIMENTS = "experiments"
    RESULTS = "results"
    DISCUSSION = "discussion"
    CONCLUSION = "conclusion"
    REFERENCES = "references"
    UNKNOWN = "unknown"

class Citation(BaseModel):
    """Citation reference"""
    id: str
    text: str
    doi: Optional[str] = None
    authors: List[str] = []
    year: Optional[int] = None

class DocumentSection(BaseModel):
    """Document section"""
    heading: str
    section_type: SectionType = SectionType.UNKNOWN
    content: str
    level: int = 1
    subsections: List["DocumentSection"] = []
    citations: List[Citation] = []
    start_pos: int = 0
    end_pos: int = 0

class CanonicalDocument(BaseModel):
    """
    Canonical document schema - all extractors output this format.
    """
    id: str
    title: str
    authors: List[str] = []
    abstract: Optional[str] = None
    year: Optional[int] = None
    doi: Optional[str] = None
    
    # Structured content
    sections: List[DocumentSection] = []
    citations: List[Citation] = []
    
    # Raw text (fallback)
    raw_text: str
    
    # Source info
    source_path: Optional[str] = None
    source_type: str = "pdf"
    page_count: int = 0
    
    # Metadata
    metadata: Dict[str, Any] = {}

# Forward reference
DocumentSection.model_rebuild()
