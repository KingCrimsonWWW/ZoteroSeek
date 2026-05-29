import hashlib
from typing import List
from backend.models.document import CanonicalDocument, DocumentSection, SectionType
from backend.models.chunk import Chunk, ChunkMetadata

class SemanticChunker:
    """
    Semantic chunker for academic papers.

    Strategy:
    1. Split by sections (heading-aware)
    2. If section > max_tokens, split by paragraphs
    3. If paragraph > max_tokens, split by sentences with overlap
    """

    def __init__(self, max_tokens: int = 800, overlap_tokens: int = 100, min_chunk_tokens: int = 50):
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens
        self.min_chunk_tokens = min_chunk_tokens

    def chunk(self, document: CanonicalDocument) -> List[Chunk]:
        """Chunk document into semantic units"""
        chunks = []
        idx = 0

        for section in document.sections:
            section_chunks = self._chunk_section(section, document, idx, [section.heading])
            chunks.extend(section_chunks)
            idx += len(section_chunks)

        return chunks

    def _chunk_section(
        self, section: DocumentSection, doc: CanonicalDocument,
        idx_start: int, heading_path: List[str],
    ) -> List[Chunk]:
        """Chunk a single section"""
        chunks = []
        text = section.content

        if not text.strip():
            return chunks

        if self._estimate_tokens(text) <= self.max_tokens:
            if len(text.strip()) >= self.min_chunk_tokens:
                chunks.append(self._make_chunk(doc, idx_start, text, section, heading_path))
        else:
            # Split by paragraphs
            paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
            current, current_tokens, idx = [], 0, idx_start

            for para in paragraphs:
                para_tokens = self._estimate_tokens(para)

                if current_tokens + para_tokens > self.max_tokens and current:
                    chunk_text = "\n\n".join(current)
                    if len(chunk_text.strip()) >= self.min_chunk_tokens:
                        chunks.append(self._make_chunk(doc, idx, chunk_text, section, heading_path))
                        idx += 1

                    # Overlap
                    overlap = self._get_overlap(chunk_text)
                    current = [overlap] if overlap else []
                    current_tokens = self._estimate_tokens(overlap) if overlap else 0

                current.append(para)
                current_tokens += para_tokens

            # Flush remaining
            if current:
                chunk_text = "\n\n".join(current)
                if len(chunk_text.strip()) >= self.min_chunk_tokens:
                    chunks.append(self._make_chunk(doc, idx, chunk_text, section, heading_path))

        # Process subsections
        for sub in section.subsections:
            sub_chunks = self._chunk_section(sub, doc, idx_start + len(chunks), heading_path + [sub.heading])
            chunks.extend(sub_chunks)

        return chunks

    def _make_chunk(
        self, doc: CanonicalDocument, idx: int, content: str,
        section: DocumentSection, heading_path: List[str],
    ) -> Chunk:
        """Create Chunk object"""
        content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]

        return Chunk(
            id=f"{doc.id}_{idx}",
            content=content,
            metadata=ChunkMetadata(
                item_id=doc.id,
                title=doc.title,
                authors=doc.authors,
                year=doc.year,
                section_type=section.section_type.value,
                heading_path=heading_path,
                content_hash=content_hash,
            ),
        )

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count (rough: 1 token ≈ 4 chars)"""
        return len(text) // 4

    def _get_overlap(self, text: str) -> str:
        """Get overlap text from end of chunk"""
        words = text.split()
        if len(words) > self.overlap_tokens:
            return " ".join(words[-self.overlap_tokens:])
        return ""
