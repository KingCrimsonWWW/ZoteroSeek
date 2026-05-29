from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import Any, Dict

class RawContent(BaseModel):
    """Raw content extracted from source"""
    content: str
    content_type: str  # "pdf", "markdown", "html"
    metadata: Dict[str, Any] = {}
    page_count: int = 0
    source_path: str = ""

class Extractor(ABC):
    """Base extractor interface"""
    
    @abstractmethod
    async def extract(self, source: str, config: Dict[str, Any] = None) -> RawContent:
        """Extract content from source"""
        ...
    
    @abstractmethod
    def supports(self, source_type: str) -> bool:
        """Check if this extractor supports the source type"""
        ...
