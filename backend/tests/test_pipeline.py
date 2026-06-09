"""
Pipeline 测试 — Parser + Chunker
"""

import pytest
from backend.extractors.base import RawContent
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker
from backend.models.document import SectionType, CanonicalDocument, DocumentSection


class TestDocumentParser:
    def setup_method(self):
        self.parser = DocumentParser()

    def test_parse_markdown_basic(self):
        raw = RawContent(
            content="# Test Paper\n\n## ABSTRACT\n\nThis is the abstract.\n\n## INTRODUCTION\n\nThis is the intro.",
            content_type="markdown", page_count=1, source_path="test.pdf",
        )
        doc = self.parser.parse(raw, "test-001")
        assert doc.id == "test-001"
        assert doc.title == "Test Paper"
        assert len(doc.sections) >= 2

    def test_parse_markdown_section_types(self):
        raw = RawContent(
            content="# Paper\n\n## ABSTRACT\n\nAbstract text.\n\n## METHODS\n\nMethods text.\n\n## RESULTS\n\nResults text.",
            content_type="markdown",
        )
        doc = self.parser.parse(raw, "test-002")
        types = {s.section_type for s in doc.sections}
        assert SectionType.ABSTRACT in types
        assert SectionType.METHODS in types
        assert SectionType.RESULTS in types

    def test_parse_plain_text(self):
        raw = RawContent(
            content="Some title text\n\nABSTRACT\nThis is the abstract.\n\nINTRODUCTION\nThis is the intro.",
            content_type="pdf",
        )
        doc = self.parser.parse(raw, "test-003")
        assert doc.source_type == "pdf"
        assert len(doc.sections) >= 1

    def test_parse_empty_content(self):
        raw = RawContent(content="", content_type="markdown")
        doc = self.parser.parse(raw, "test-empty")
        assert doc.sections == []
        assert doc.title == "Untitled"

    def test_parse_unknown_section(self):
        """无法识别的标题被标记为 UNKNOWN"""
        raw = RawContent(
            content="# Paper\n\n## CUSTOM HEADING\n\nSome content.",
            content_type="markdown",
        )
        doc = self.parser.parse(raw, "test-unknown")
        # Parser 会为 # 和 ## 各创建一个 section
        assert len(doc.sections) >= 1
        custom = [s for s in doc.sections if s.heading == "CUSTOM HEADING"]
        assert len(custom) == 1
        assert custom[0].section_type == SectionType.UNKNOWN


class TestSemanticChunker:
    def setup_method(self):
        self.chunker = SemanticChunker(max_tokens=100, overlap_tokens=20, min_chunk_tokens=5)

    def _make_doc(self, sections):
        raw = " ".join(s.content for s in sections)
        return CanonicalDocument(id="test", title="Test", sections=sections, raw_text=raw)

    def test_chunk_short_section(self):
        doc = self._make_doc([DocumentSection(
            heading="ABSTRACT", section_type=SectionType.ABSTRACT, content="Short abstract text.",
        )])
        chunks = self.chunker.chunk(doc)
        assert len(chunks) == 1
        assert "Short abstract text" in chunks[0].content

    def test_chunk_long_section(self):
        """长 section 被拆分为多个 chunk（需要 \n\n 分隔的段落）"""
        # max_tokens=100 → 约 400 字符，每段用 \n\n 分隔
        paragraphs = ["This is a paragraph for testing chunking behavior. " * 5] * 10
        long_content = "\n\n".join(paragraphs)
        doc = self._make_doc([DocumentSection(
            heading="INTRODUCTION", section_type=SectionType.INTRODUCTION, content=long_content,
        )])
        chunks = self.chunker.chunk(doc)
        assert len(chunks) >= 2
        for c in chunks:
            assert c.metadata.section_type == "introduction"

    def test_chunk_empty_section(self):
        doc = self._make_doc([DocumentSection(
            heading="EMPTY", section_type=SectionType.UNKNOWN, content="",
        )])
        assert len(self.chunker.chunk(doc)) == 0

    def test_chunk_heading_path(self):
        doc = self._make_doc([DocumentSection(
            heading="METHODS", section_type=SectionType.METHODS, content="Method description here.",
        )])
        chunks = self.chunker.chunk(doc)
        assert len(chunks) == 1
        assert chunks[0].metadata.heading_path == ["METHODS"]

    def test_chunk_id_format(self):
        """chunk ID 格式为 {doc_id}_{idx}"""
        doc = self._make_doc([
            DocumentSection(heading="A", section_type=SectionType.ABSTRACT, content="Content for section A here."),
            DocumentSection(heading="B", section_type=SectionType.INTRODUCTION, content="Content for section B here."),
        ])
        chunks = self.chunker.chunk(doc)
        assert len(chunks) == 2
        assert chunks[0].id.startswith("test_")
        assert chunks[1].id.startswith("test_")
        assert chunks[0].id != chunks[1].id

    def test_chunk_content_hash_unique(self):
        doc = self._make_doc([
            DocumentSection(heading="A", section_type=SectionType.ABSTRACT, content="Content A."),
            DocumentSection(heading="B", section_type=SectionType.INTRODUCTION, content="Content B."),
        ])
        hashes = [c.metadata.content_hash for c in self.chunker.chunk(doc)]
        assert len(hashes) == len(set(hashes))

    def test_heading_path_never_empty(self):
        doc = self._make_doc([DocumentSection(
            heading="", section_type=SectionType.UNKNOWN, content="Content with empty heading.",
        )])
        for chunk in self.chunker.chunk(doc):
            assert len(chunk.metadata.heading_path) > 0
