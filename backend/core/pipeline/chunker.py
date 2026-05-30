"""
Markdown 感知的语义分块器

改进点：
1. 不在表格（|...|）、公式（$$...$$）、代码块（```）中间断开
2. 保留 Markdown 格式标记
3. min_chunk_tokens 使用 token 估算而非字符数
4. Overlap 按段落边界重叠
"""

import hashlib
import re
from typing import List
from backend.models.document import CanonicalDocument, DocumentSection, SectionType
from backend.models.chunk import Chunk, ChunkMetadata


class SemanticChunker:
    """Markdown 感知的学术论文语义分块器"""

    def __init__(self, max_tokens: int = 800, overlap_tokens: int = 100, min_chunk_tokens: int = 50):
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens
        self.min_chunk_tokens = min_chunk_tokens

    def chunk(self, document: CanonicalDocument) -> List[Chunk]:
        """将文档按 sections 分块"""
        chunks: List[Chunk] = []
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
        """分块单个 section"""
        chunks: List[Chunk] = []
        text = section.content

        if not text.strip():
            return chunks

        # 如果 section 整体在 token 限制内，直接作为一个 chunk
        if self._estimate_tokens(text) <= self.max_tokens:
            if self._estimate_tokens(text.strip()) >= self.min_chunk_tokens:
                chunks.append(self._make_chunk(doc, idx_start, text, section, heading_path))
        else:
            # 按段落拆分，Markdown 感知
            paragraphs = self._split_markdown_paragraphs(text)
            current: List[str] = []
            current_tokens = 0
            idx = idx_start

            for para in paragraphs:
                para_tokens = self._estimate_tokens(para)

                # 如果加上这个段落会超限，先保存当前 chunk
                if current_tokens + para_tokens > self.max_tokens and current:
                    chunk_text = "\n\n".join(current)
                    if self._estimate_tokens(chunk_text.strip()) >= self.min_chunk_tokens:
                        chunks.append(self._make_chunk(doc, idx, chunk_text, section, heading_path))
                        idx += 1

                    # Overlap：取上一个 chunk 末尾的段落
                    overlap = self._get_overlap(current)
                    current = overlap
                    current_tokens = sum(self._estimate_tokens(p) for p in overlap)

                current.append(para)
                current_tokens += para_tokens

            # 保存剩余内容
            if current:
                chunk_text = "\n\n".join(current)
                if self._estimate_tokens(chunk_text.strip()) >= self.min_chunk_tokens:
                    chunks.append(self._make_chunk(doc, idx, chunk_text, section, heading_path))

        # 递归处理子 sections
        for sub in section.subsections:
            sub_chunks = self._chunk_section(sub, doc, idx_start + len(chunks), heading_path + [sub.heading])
            chunks.extend(sub_chunks)

        return chunks

    def _split_markdown_paragraphs(self, text: str) -> List[str]:
        """
        按段落拆分 Markdown 文本，保留特殊块的完整性：
        - 表格（连续的 | 行）
        - 公式块（$$...$$）
        - 代码块（```...```）
        - 列表项（- / * / 1.）
        """
        blocks: List[str] = []
        current_block: List[str] = []
        in_math = False
        in_code = False

        for line in text.split("\n"):
            stripped = line.strip()

            # 公式块边界
            if stripped.startswith("$$"):
                if in_math:
                    current_block.append(line)
                    blocks.append("\n".join(current_block))
                    current_block = []
                    in_math = False
                    continue
                elif not in_code:
                    # 保存之前的普通段落
                    if current_block and not in_math:
                        blocks.append("\n".join(current_block))
                        current_block = []
                    in_math = True

            # 代码块边界
            if stripped.startswith("```"):
                if in_code:
                    current_block.append(line)
                    blocks.append("\n".join(current_block))
                    current_block = []
                    in_code = False
                    continue
                elif not in_math:
                    if current_block:
                        blocks.append("\n".join(current_block))
                        current_block = []
                    in_code = True

            # 在特殊块内，直接累积
            if in_math or in_code:
                current_block.append(line)
                continue

            # 空行 = 段落分隔
            if not stripped:
                if current_block:
                    blocks.append("\n".join(current_block))
                    current_block = []
                continue

            # 表格行：连续的 | 行应该在一起
            if stripped.startswith("|"):
                # 如果前一个 block 不是表格，先保存
                if current_block and not current_block[-1].strip().startswith("|"):
                    blocks.append("\n".join(current_block))
                    current_block = []
                current_block.append(line)
                continue

            # 列表项：连续的列表行应该在一起
            if re.match(r"^(\-\s|\*\s|\d+\.\s)", stripped):
                # 如果前一个 block 不是列表，先保存
                if current_block and not re.match(r"^(\-\s|\*\s|\d+\.\s)", current_block[-1].strip()):
                    blocks.append("\n".join(current_block))
                    current_block = []
                current_block.append(line)
                continue

            # 普通文本行
            current_block.append(line)

        # 保存最后一个 block
        if current_block:
            blocks.append("\n".join(current_block))

        # 清理空块
        return [b for b in blocks if b.strip()]

    def _get_overlap(self, paragraphs: List[str]) -> List[str]:
        """
        取上一个 chunk 末尾的段落作为 overlap。

        策略：从后往前取段落，直到累计 token 数达到 overlap_tokens。
        """
        if not paragraphs:
            return []

        overlap: List[str] = []
        total_tokens = 0

        for para in reversed(paragraphs):
            para_tokens = self._estimate_tokens(para)
            if total_tokens + para_tokens > self.overlap_tokens:
                break
            overlap.insert(0, para)
            total_tokens += para_tokens

        return overlap

    def _make_chunk(
        self, doc: CanonicalDocument, idx: int, content: str,
        section: DocumentSection, heading_path: List[str],
    ) -> Chunk:
        """创建 Chunk 对象"""
        content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
        authors = doc.authors if doc.authors else ["Unknown"]

        return Chunk(
            id=f"{doc.id}_{idx}",
            content=content,
            metadata=ChunkMetadata(
                item_id=doc.id,
                title=doc.title,
                authors=authors,
                year=doc.year,
                section_type=section.section_type.value,
                heading_path=heading_path,
                content_hash=content_hash,
            ),
        )

    def _estimate_tokens(self, text: str) -> int:
        """估算 token 数（粗略：1 token ≈ 4 字符）"""
        return len(text) // 4
