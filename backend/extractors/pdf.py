import fitz  # PyMuPDF
from typing import Dict, Any
from backend.extractors.base import Extractor, RawContent
from loguru import logger

class PDFExtractor(Extractor):
    """PDF text extraction using PyMuPDF"""
    
    async def extract(self, source: str, config: Dict[str, Any] = None) -> RawContent:
        """Extract text from PDF file"""
        logger.info(f"[PDF] Extracting: {source}")
        
        doc = fitz.open(source)
        pages = []
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                pages.append(text)
        
        doc.close()
        
        full_text = "\n\n".join(pages)
        logger.info(f"[PDF] Extracted {len(pages)} pages, {len(full_text)} chars")
        
        return RawContent(
            content=full_text,
            content_type="pdf",
            page_count=len(pages),
            source_path=source,
            metadata={"pages": len(pages)},
        )
    
    def supports(self, source_type: str) -> bool:
        return source_type.lower() == "pdf"
