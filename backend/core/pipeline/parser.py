"""
Markdown 感知的文档解析器

解析 MinerU 输出的结构化 Markdown，提取：
- 标题层级（# / ## / ###）
- 学术论文分段（Abstract、Introduction、Methods 等）
- 元数据（标题、作者、摘要）

同时兼容 PyMuPDF 的纯文本输出（fallback 到逐行匹配）。
"""

import re
from typing import List, Optional, Tuple
from backend.models.document import CanonicalDocument, DocumentSection, SectionType
from backend.extractors.base import RawContent
from loguru import logger


class DocumentParser:
    """解析 RawContent 为 CanonicalDocument，支持 Markdown 和纯文本"""

    # Markdown 标题模式：# Title / ## Section / ### Subsection
    MD_HEADER_PATTERN = re.compile(r"^(#{1,6})\s+(.+)$")

    # 学术论文分段关键词匹配
    SECTION_KEYWORDS = [
        ("abstract", SectionType.ABSTRACT),
        ("introduction", SectionType.INTRODUCTION),
        ("related work", SectionType.RELATED_WORK),
        ("background", SectionType.RELATED_WORK),
        ("method", SectionType.METHODS),
        ("methodology", SectionType.METHODS),
        ("approach", SectionType.METHODS),
        ("framework", SectionType.METHODS),
        ("experiment", SectionType.EXPERIMENTS),
        ("evaluation", SectionType.EXPERIMENTS),
        ("result", SectionType.RESULTS),
        ("finding", SectionType.RESULTS),
        ("discussion", SectionType.DISCUSSION),
        ("conclusion", SectionType.CONCLUSION),
        ("summary", SectionType.CONCLUSION),
        ("reference", SectionType.REFERENCES),
        ("bibliography", SectionType.REFERENCES),
    ]

    # 纯文本分段模式（兼容 PyMuPDF 输出）
    PLAIN_SECTION_PATTERNS = [
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
        """根据 content_type 选择解析策略"""
        if raw.content_type == "markdown":
            return self._parse_markdown(raw, item_id)
        else:
            return self._parse_plain(raw, item_id)

    # ── Markdown 解析 ──────────────────────────────────────────────

    def _parse_markdown(self, raw: RawContent, item_id: str) -> CanonicalDocument:
        """解析 MinerU 输出的 Markdown"""
        text = raw.content
        title, authors, abstract = self._extract_metadata(text)
        sections = self._split_markdown_sections(text)

        logger.info(
            f"[Parser] Markdown 解析完成: title='{title}', "
            f"{len(sections)} sections, {len(authors)} authors"
        )

        return CanonicalDocument(
            id=item_id,
            title=title,
            authors=authors,
            abstract=abstract,
            sections=sections,
            raw_text=text,
            page_count=raw.page_count,
            source_path=raw.source_path,
            source_type="markdown",
        )

    def _extract_metadata(self, text: str) -> Tuple[str, List[str], Optional[str]]:
        """从 Markdown 开头提取标题、作者、摘要"""
        lines = text.strip().split("\n")
        title = "Untitled"
        authors: List[str] = []
        abstract: Optional[str] = None

        # 提取标题：第一个 # 标题
        for line in lines:
            match = self.MD_HEADER_PATTERN.match(line.strip())
            if match:
                title = match.group(2).strip()
                break
            # 也可能第一行就是标题（无 # 前缀）
            stripped = line.strip()
            if stripped and len(stripped) > 3:
                title = stripped
                break

        # 提取作者：通常在标题之后、Abstract 之前
        # 常见模式："Author1, Author2, Author3" 或 "by Author1 et al."
        in_header = False
        for line in lines[:30]:  # 只看前 30 行
            stripped = line.strip()
            if not stripped:
                continue

            # 跳过标题行
            if self.MD_HEADER_PATTERN.match(stripped):
                if in_header:
                    break  # 到了下一个标题，退出
                in_header = True
                continue

            # 检测作者行（含逗号分隔的人名，或 "by ..."）
            if in_header and not abstract:
                # 匹配 "Author1, Author2, Author3" 模式
                if "," in stripped and len(stripped) < 500:
                    parts = [p.strip() for p in stripped.split(",")]
                    # 过滤掉太长的部分（可能是句子而非人名）
                    if all(len(p) < 60 for p in parts):
                        authors = parts
                        continue

        # 提取 Abstract
        abstract_match = re.search(
            r"(?:^|\n)#+\s*(?:Abstract|ABSTRACT)\s*\n(.*?)(?=\n#|\Z)",
            text, re.DOTALL | re.IGNORECASE,
        )
        if abstract_match:
            abstract = abstract_match.group(1).strip()[:1000]  # 限制长度

        return title, authors, abstract

    def _split_markdown_sections(self, text: str) -> List[DocumentSection]:
        """按 Markdown 标题拆分 sections，保留层级结构"""
        sections: List[DocumentSection] = []
        current_heading = None
        current_level = 0
        current_lines: List[str] = []

        for line in text.split("\n"):
            match = self.MD_HEADER_PATTERN.match(line.strip())

            if match:
                # 遇到新标题，保存之前的内容
                if current_heading is not None:
                    content = "\n".join(current_lines).strip()
                    section_type = self._classify_section(current_heading)
                    sections.append(DocumentSection(
                        heading=current_heading,
                        section_type=section_type,
                        content=content,
                        level=current_level,
                    ))
                elif current_lines:
                    # 标题之前的内容 → 作为 Introduction 或 metadata
                    content = "\n".join(current_lines).strip()
                    if content and len(content) > 50:
                        sections.append(DocumentSection(
                            heading="Introduction",
                            section_type=SectionType.INTRODUCTION,
                            content=content,
                            level=1,
                        ))

                current_heading = match.group(2).strip()
                current_level = len(match.group(1))  # # = 1, ## = 2, ### = 3
                current_lines = []
            else:
                current_lines.append(line)

        # 保存最后一个 section
        if current_heading is not None:
            content = "\n".join(current_lines).strip()
            section_type = self._classify_section(current_heading)
            sections.append(DocumentSection(
                heading=current_heading,
                section_type=section_type,
                content=content,
                level=current_level,
            ))

        return sections

    def _classify_section(self, heading: str) -> SectionType:
        """根据标题文本匹配 SectionType"""
        heading_lower = heading.lower()
        for keyword, section_type in self.SECTION_KEYWORDS:
            if keyword in heading_lower:
                return section_type
        return SectionType.UNKNOWN

    # ── 纯文本解析（兼容 PyMuPDF）──────────────────────────────────

    def _parse_plain(self, raw: RawContent, item_id: str) -> CanonicalDocument:
        """解析纯文本（PyMuPDF 输出），使用正则匹配分段"""
        text = raw.content
        title = self._extract_title_plain(text)
        sections = self._extract_sections_plain(text)

        return CanonicalDocument(
            id=item_id,
            title=title,
            sections=sections,
            raw_text=text,
            page_count=raw.page_count,
            source_path=raw.source_path,
            source_type="pdf",
        )

    def _extract_title_plain(self, text: str) -> str:
        """从纯文本提取标题（第一行有意义的文字）"""
        for line in text.split("\n"):
            line = line.strip()
            if line and len(line) > 5:
                return line
        return "Untitled"

    def _extract_sections_plain(self, text: str) -> List[DocumentSection]:
        """正则匹配纯文本中的学术论文分段"""
        sections: List[DocumentSection] = []
        current_section: Optional[DocumentSection] = None
        current_content: List[str] = []

        for line in text.split("\n"):
            stripped = line.strip()
            section_type = self._match_plain_header(stripped)

            if section_type:
                if current_section:
                    current_section.content = "\n".join(current_content).strip()
                    sections.append(current_section)
                current_section = DocumentSection(
                    heading=stripped,
                    section_type=section_type,
                    content="",
                )
                current_content = []
            elif current_section:
                current_content.append(line)
            elif stripped:
                # 标题前的内容 → Introduction
                if not current_section:
                    current_section = DocumentSection(
                        heading="Introduction",
                        section_type=SectionType.INTRODUCTION,
                        content="",
                    )
                current_content.append(line)

        if current_section:
            current_section.content = "\n".join(current_content).strip()
            sections.append(current_section)

        return sections

    def _match_plain_header(self, line: str) -> Optional[SectionType]:
        """正则匹配纯文本行是否为分段标题"""
        for pattern, section_type in self.PLAIN_SECTION_PATTERNS:
            if re.match(pattern, line, re.IGNORECASE):
                return section_type
        return None
