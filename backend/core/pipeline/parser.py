import re
from typing import List
from backend.models.document import CanonicalDocument, DocumentSection, SectionType
from backend.extractors.base import RawContent

class DocumentParser:
    """Parse raw content into CanonicalDocument"""
    
    # Section header patterns (academic papers)
    SECTION_PATTERNS = [
        (r"^(?:ABSTRACT|Abstract)", SectionType.ABSTRACT),
        (r"^(?:\d+\.?\s*)?(?:INTRODUCTION|Introduction)", SectionType.INTRODUCTION),
        (r"^(?:\d+\.?\s*)?(?:RELATED\s+WORK|Related\s+Work)", SectionType.RELATED_WORK),
        (r"^(?:\d+\.?\s*)?(?:METHODS?|Methods?|METHODOLOGY|Methodology)", SectionType.METHODS),
        (r"^(?:\d+\.?\s*)?(?:EXPERIMENTS?|Experiments?)", SectionType.EXPERIMENTS),
        (r"^(?:\d+\.?\s*)?(?:RESULTS?|Results?)", SectionType.RESULTS),
        (r"^(?:\d+\.?\s*)?(?:DISCUSSION|Discussion)", SectionType.DISCUSSION),
        (r"^(?:\d+\.?\s*)?(?:CONCLUSIONS?|Conclusions?)", SectionType.CONCLUSION),
        (r"^(?:REFERENCES|References)", SectionType.REFERENCES),
    ]
    
    def parse(self, raw: RawContent, item_id: str) -> CanonicalDocument:
        """Parse raw content into canonical document"""
        text = raw.content
        
        # Extract title (first non-empty line)
        title = self._extract_title(text)
        
        # Extract sections
        sections = self._extract_sections(text)
        
        return CanonicalDocument(
            id=item_id,
            title=title,
            sections=sections,
            raw_text=text,
            page_count=raw.page_count,
            source_path=raw.source_path,
            source_type=raw.content_type,
        )
    
    def _extract_title(self, text: str) -> str:
        """Extract title from first non-empty line"""
        for line in text.split("\n"):
            line = line.strip()
            if line and len(line) > 5:
                return line
        return "Untitled"
    
    def _extract_sections(self, text: str) -> List[DocumentSection]:
        """Extract sections based on header patterns"""
        sections = []
        current_section = None
        current_content = []
        
        for line in text.split("\n"):
            stripped = line.strip()
            
            # Check if line is a section header
            section_type = self._match_section_header(stripped)
            
            if section_type:
                # Save previous section
                if current_section:
                    current_section.content = "\n".join(current_content).strip()
                    sections.append(current_section)
                
                # Start new section
                current_section = DocumentSection(
                    heading=stripped,
                    section_type=section_type,
                    content="",
                )
                current_content = []
            elif current_section:
                current_content.append(line)
            else:
                # Content before first section -> intro
                if not current_section and stripped:
                    current_section = DocumentSection(
                        heading="Introduction",
                        section_type=SectionType.INTRODUCTION,
                        content="",
                    )
                    current_content.append(line)
        
        # Save last section
        if current_section:
            current_section.content = "\n".join(current_content).strip()
            sections.append(current_section)
        
        return sections
    
    def _match_section_header(self, line: str) -> SectionType | None:
        """Match line against section patterns"""
        for pattern, section_type in self.SECTION_PATTERNS:
            if re.match(pattern, line, re.IGNORECASE):
                return section_type
        return None
