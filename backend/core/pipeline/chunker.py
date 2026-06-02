"""
Markdown 感知的语义分块器（Semantic Chunker）

核心改进点：
1. 不在表格（|...|）、公式（$$...$$）、代码块（```）中间断开
2. 保留 Markdown 格式标记
3. min_chunk_tokens 使用 token 估算而非字符数
4. Overlap 按段落边界重叠

设计思路与技术决策：

【为什么需要分块？】
嵌入模型（如 text-embedding-ada-002）有上下文窗口限制（通常 8192 token），
而且过长的文本会稀释语义信息，降低检索质量。分块是 RAG 系统的关键预处理步骤。

【为什么选择 Markdown 感知的分块？】
传统的"按固定字数切分"会导致：
- 表格被从中间切断，失去结构化语义
- 公式被切断，产生无意义的文本碎片
- 代码块被切断，丢失上下文
Markdown 感知分块确保这些结构化内容的完整性，提高检索质量。

【分块策略：基于 Section 的层次化分块】
1. 首先按文档的章节（Section）进行第一层切分
2. 如果一个 Section 的 token 数在限制内，直接作为一个 Chunk
3. 如果超出限制，再按段落进行第二层切分
4. 子 Section 递归处理
这种策略保证了每个 Chunk 都有明确的章节归属，便于后续的元数据管理和溯源。

【Overlap（重叠）策略】
相邻 Chunk 之间保留一定量的重叠文本，目的是：
- 防止关键信息恰好被切在两个 Chunk 的边界上
- 提供跨 Chunk 的上下文连续性
- 类似于卷积神经网络中的滑动窗口思想
"""

import hashlib
import re
from typing import List
from backend.models.document import CanonicalDocument, DocumentSection, SectionType
from backend.models.chunk import Chunk, ChunkMetadata


class SemanticChunker:
    """Markdown 感知的学术论文语义分块器"""

    # 构造参数说明：
    # - max_tokens: 每个 Chunk 的最大 token 数，需小于嵌入模型的上下文窗口
    # - overlap_tokens: 相邻 Chunk 的重叠 token 数，保证上下文连续性
    # - min_chunk_tokens: 最小 Chunk token 数，过小的 Chunk 语义信息不足，应被合并
    def __init__(self, max_tokens: int = 800, overlap_tokens: int = 100, min_chunk_tokens: int = 50):
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens
        self.min_chunk_tokens = min_chunk_tokens

    def chunk(self, document: CanonicalDocument) -> List[Chunk]:
        """将文档按 sections 分块"""
        chunks: List[Chunk] = []
        idx = 0

        # 遍历文档的每个顶层 Section，分别进行分块
        # 使用递增的 idx 确保每个 Chunk 有全局唯一的索引
        for section in document.sections:
            section_chunks = self._chunk_section(section, document, idx, [section.heading])
            chunks.extend(section_chunks)
            idx += len(section_chunks)

        return chunks

    def _chunk_section(
        self, section: DocumentSection, doc: CanonicalDocument,
        idx_start: int, heading_path: List[str],
    ) -> List[Chunk]:
        """分块单个 section

        Args:
            section: 当前要分块的文档章节
            doc: 完整文档对象，用于提取全局元数据（标题、作者等）
            idx_start: 当前 Chunk 的起始索引，保证全局唯一
            heading_path: 标题层级路径（如 ["Introduction", "Background"]），
                         用于元数据记录，方便溯源到原始文档位置
        """
        chunks: List[Chunk] = []
        text = section.content

        if not text.strip():
            return chunks

        # 快速路径：如果整个 Section 的 token 数在限制内，直接作为一个 Chunk
        # 避免不必要的段落拆分，保持内容的完整性
        if self._estimate_tokens(text) <= self.max_tokens:
            if self._estimate_tokens(text.strip()) >= self.min_chunk_tokens:
                chunks.append(self._make_chunk(doc, idx_start, text, section, heading_path))
        else:
            # 慢路径：Section 超出 token 限制，需要按段落拆分
            # 使用 Markdown 感知的段落拆分，确保结构化内容不被切断
            paragraphs = self._split_markdown_paragraphs(text)
            current: List[str] = []      # 当前正在积累的段落列表
            current_tokens = 0           # 当前积累的 token 总数
            idx = idx_start

            for para in paragraphs:
                para_tokens = self._estimate_tokens(para)

                # 核心逻辑：如果加上当前段落会超过 token 限制
                # 则将已积累的段落保存为一个 Chunk，并开始新的 Chunk
                if current_tokens + para_tokens > self.max_tokens and current:
                    chunk_text = "\n\n".join(current)
                    if self._estimate_tokens(chunk_text.strip()) >= self.min_chunk_tokens:
                        chunks.append(self._make_chunk(doc, idx, chunk_text, section, heading_path))
                        idx += 1

                    # Overlap 策略：从上一个 Chunk 的末尾取部分段落
                    # 这样新 Chunk 的开头会包含上一个 Chunk 的结尾内容
                    # 保证了语义的连续性，防止关键信息被切断
                    overlap = self._get_overlap(current)
                    current = overlap
                    current_tokens = sum(self._estimate_tokens(p) for p in overlap)

                current.append(para)
                current_tokens += para_tokens

            # 处理最后剩余的段落（不满一个 max_tokens 的尾部内容）
            if current:
                chunk_text = "\n\n".join(current)
                if self._estimate_tokens(chunk_text.strip()) >= self.min_chunk_tokens:
                    chunks.append(self._make_chunk(doc, idx, chunk_text, section, heading_path))

        # 递归处理子 Section（如 Section 下的 Subsection）
        # heading_path 逐层累积，形成完整的标题路径
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

        实现原理：
        使用状态机逐行扫描，通过 in_math 和 in_code 两个布尔标志
        追踪当前是否处于特殊块（公式/代码块）内部。
        特殊块内的所有行都会被合并为一个整体，不会被段落分隔符打断。
        """
        blocks: List[str] = []
        current_block: List[str] = []
        in_math = False    # 状态标记：是否在公式块（$$...$$）内部
        in_code = False    # 状态标记：是否在代码块（```...```）内部

        for line in text.split("\n"):
            stripped = line.strip()

            # 公式块边界检测：$$ 既是开始标记也是结束标记
            # 使用状态翻转逻辑：遇到 $$ 时从 in_math=False 变为 True（开始），或反之（结束）
            if stripped.startswith("$$"):
                if in_math:
                    current_block.append(line)
                    blocks.append("\n".join(current_block))
                    current_block = []
                    in_math = False
                    continue
                elif not in_code:
                    # 进入公式块前，先保存之前积累的普通段落
                    if current_block and not in_math:
                        blocks.append("\n".join(current_block))
                        current_block = []
                    in_math = True

            # 代码块边界检测：``` 的处理逻辑与公式块类似
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

            # 在特殊块内部，所有行直接累积，不做任何段落拆分
            if in_math or in_code:
                current_block.append(line)
                continue

            # 空行是 Markdown 的标准段落分隔符
            if not stripped:
                if current_block:
                    blocks.append("\n".join(current_block))
                    current_block = []
                continue

            # 表格行合并：连续的 | 开头的行必须保持在一起
            # 如果当前积累的不是表格行，则先保存，再开始新的表格块
            if stripped.startswith("|"):
                if current_block and not current_block[-1].strip().startswith("|"):
                    blocks.append("\n".join(current_block))
                    current_block = []
                current_block.append(line)
                continue

            # 列表项合并：连续的列表行（-、*、1.）保持在一起
            # 使用正则匹配列表项前缀，防止普通文本被误判
            if re.match(r"^(\-\s|\*\s|\d+\.\s)", stripped):
                if current_block and not re.match(r"^(\-\s|\*\s|\d+\.\s)", current_block[-1].strip()):
                    blocks.append("\n".join(current_block))
                    current_block = []
                current_block.append(line)
                continue

            # 普通文本行，直接追加到当前块
            current_block.append(line)

        # 保存最后一个 block（循环结束后可能还有未保存的内容）
        if current_block:
            blocks.append("\n".join(current_block))

        # 清理空块，避免产生无意义的空 Chunk
        return [b for b in blocks if b.strip()]

    def _get_overlap(self, paragraphs: List[str]) -> List[str]:
        """
        取上一个 chunk 末尾的段落作为 overlap。

        策略：从后往前取段落，直到累计 token 数达到 overlap_tokens。
        这样做的好处：
        1. 保证重叠内容是完整的段落（不会从段落中间切断）
        2. 重叠量大致可控（以 token 数为标准，而非字符数）
        3. 语义连续性好（重叠的是最近的上下文）

        为什么从后往前取：
        - 越靠近边界的段落，与下一个 Chunk 的语义关联性越强
        - 这类似于 NLP 中的"上下文窗口"思想
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
        """创建 Chunk 对象

        每个 Chunk 包含：
        - 唯一 ID：由文档 ID 和索引组成，用于向量数据库的主键
        - 文本内容：分块后的实际文本
        - 元数据：包含文档标题、作者、年份、章节类型、标题路径等
          这些元数据在检索时可用于过滤和排序（如"只搜索 Introduction 章节"）
        - content_hash：内容的哈希值，用于检测重复内容和增量更新
        """
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
        """估算 token 数（粗略：1 token ≈ 4 字符）

        这是一个简化的估算方法。实际的 token 数取决于具体的分词器（tokenizer）。
        对于英文文本，GPT 系列模型大约是 1 token ≈ 4 字符。
        对于中文文本，这个估算会偏低（中文每个字通常占 2-3 个 token），
        但作为分块大小的控制依据已经足够，因为目的是"大致不超限"而非精确计数。
        """
        return len(text) // 4
