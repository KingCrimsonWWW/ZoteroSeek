# ZoteroSeek 后端架构详解

> 本文档是 ZoteroSeek 后端的技术面试参考手册，覆盖 FastAPI 应用、RAG 流水线、向量检索、SSE 流式响应等核心模块。

---

## 一、目录结构与分层架构

```
backend/
├── main.py                    # FastAPI 应用入口
├── config/
│   └── settings.py            # Pydantic Settings 配置管理
├── api/                       # API 层（HTTP 路由、请求/响应模型）
│   ├── chat.py                # SSE 流式聊天接口
│   ├── search.py              # 语义搜索接口
│   ├── index.py               # PDF 索引入口
│   ├── shared_deps.py         # 共享依赖单例管理
│   ├── health.py              # 健康检查
│   ├── library.py             # 文献库管理
│   └── zotero.py              # Zotero 集成
├── core/                      # 核心业务逻辑层
│   ├── pipeline/              # 文档摄入流水线
│   │   ├── interfaces.py      # PipelineContext / PipelineResult 数据模型
│   │   ├── ingestion.py       # 5 阶段流水线编排器
│   │   ├── parser.py          # Markdown 感知的文档解析器
│   │   └── chunker.py         # 语义分块器
│   ├── rag/                   # RAG 检索增强生成
│   │   ├── retriever.py       # 向量检索器
│   │   └── chat_integration.py # RAG 编排（检索→上下文→Prompt）
│   ├── llm/                   # LLM 客户端
│   │   ├── client.py          # OpenAI 兼容 Chat API 客户端
│   │   └── embeddings.py      # OpenAI 兼容 Embedding API 客户端
│   └── prompts/
│       └── registry.py        # Prompt 模板注册表
├── data/                      # 数据层（持久化）
│   ├── db.py                  # SQLAlchemy 引擎 + 会话工厂
│   ├── models.py              # ORM 模型（Item 表）
│   ├── chroma_store.py        # ChromaDB 向量存储实现
│   └── vector_store.py        # VectorStore 抽象基类（ABC）
├── models/                    # 领域模型（Pydantic）
│   ├── document.py            # CanonicalDocument / DocumentSection / SectionType
│   └── chunk.py               # Chunk / ChunkMetadata
└── extractors/                # 提取器层（文档解析策略）
    ├── base.py                # Extractor ABC + RawContent 数据契约
    ├── mineru_extractor.py    # MinerU 云端 API 提取器（4 步异步流程）
    └── pdf.py                 # PyMuPDF 本地提取器（asyncio.to_thread）
```

### 各层职责

| 层 | 目录 | 职责 | 关键设计模式 |
|---|---|---|---|
| **API 层** | `api/` | HTTP 路由定义、请求校验、响应序列化 | FastAPI Router + Pydantic BaseModel |
| **核心层** | `core/` | 业务逻辑编排（RAG 流水线、LLM 交互） | 策略模式、依赖注入 |
| **数据层** | `data/` | 持久化存储（向量 + 关系型） | 适配器模式（Adapter） |
| **模型层** | `models/` | 领域数据模型定义 | Pydantic BaseModel + Enum |
| **提取器层** | `extractors/` | 从原始文件中提取文本 | 抽象工厂 + 模板方法 |

**分层的核心原则**：API 层只做 HTTP 协议转换，不包含业务逻辑；核心层不直接依赖具体的数据库或 API 实现；数据层通过抽象接口隔离具体存储引擎。

---

## 二、FastAPI 应用启动流程

### 2.1 应用入口 (`backend/main.py`)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from backend.api.health import router as health_router
from backend.api.index import router as index_router
from backend.api.search import router as search_router
from backend.api.chat import router as chat_router
from backend.api.library import router as library_router
from backend.api.zotero import router as zotero_router
from backend.config.settings import settings
from backend.data.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    init_db()  # 启动时创建 SQLite 表结构
    yield      # 应用运行期间
    # （此处可添加关闭时的清理逻辑）

app = FastAPI(
    title="ZoteroSeek API",
    version="0.1.0",
    description="Local AI Research Assistant Runtime",
    lifespan=lifespan,  # 使用 FastAPI 0.93+ 的 lifespan 替代旧的 startup/shutdown
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # 允许所有来源（本地开发用）
    allow_credentials=False,  # allow_credentials=True 时不能用 "*"
    allow_methods=["*"],
    allow_headers=["*"],
)

# 路由注册 — 统一 /api/v1 前缀
app.include_router(health_router, prefix="/api/v1")
app.include_router(index_router, prefix="/api/v1")
app.include_router(search_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(library_router, prefix="/api/v1")
app.include_router(zotero_router, prefix="/api/v1")

# 静态文件挂载（React 前端 build 产物）
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
```

### 2.2 启动流程时序

```
用户执行 uvicorn backend.main:app
    │
    ▼
Python 解释器加载 backend.main 模块
    │
    ├─ 1. 导入 settings → 触发 Pydantic Settings 从 .env 加载配置
    │
    ├─ 2. 创建 FastAPI 实例，绑定 lifespan
    │
    ├─ 3. 添加 CORS 中间件
    │
    ├─ 4. include_router 注册 6 个路由模块
    │      每个 router 内的 @router.post/@router.get 装饰器注册到路由表
    │
    ├─ 5. 挂载 static 目录（React SPA 的 fallback 路由）
    │
    ▼
Uvicorn 启动 ASGI 服务器（host=127.0.0.1, port=20801）
    │
    ├─ 6. 触发 lifespan 上下文管理器
    │      ├─ init_db() → SQLAlchemy 创建 SQLite 表（如不存在）
    │      └─ yield → 服务器开始接收请求
    │
    ▼
应用就绪，等待 HTTP 请求
```

### 2.3 CORS 配置注意事项

```python
# 关键知识点：allow_credentials 与 allow_origins 的互斥限制
# CORS 规范规定：allow_credentials=True 时，allow_origins 不能是 "*"
# 因为携带 Cookie 的请求必须明确指定允许的源
# 本地开发用 allow_credentials=False + allow_origins=["*"] 即可

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # 不能与 allow_origins=["*"] 同时为 True
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 三、Pydantic Settings 配置管理

### 3.1 Settings 定义 (`backend/config/settings.py`)

```python
from pydantic_settings import BaseSettings
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.parent  # 项目根目录

class Settings(BaseSettings):
    """应用配置 — 从环境变量和 .env 文件加载，支持类型校验"""

    # Server
    host: str = "127.0.0.1"
    port: int = 20801
    debug: bool = False

    # Zotero
    zotero_api_url: str = "http://localhost:23119/api"
    zotero_api_key: str = ""
    zotero_storage_path: str = ""

    # LLM
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"

    # Embedding
    embedding_api_key: str = ""
    embedding_base_url: str = "https://api.openai.com/v1"
    embedding_model: str = "text-embedding-3-small"

    # MinerU (PDF 解析)
    mineru_api_url: str = ""
    mineru_api_key: str = ""
    mineru_backend: str = "pipeline"
    mineru_parse_method: str = "auto"
    mineru_language: str = "ch"

    # Database
    sqlite_path: str = "./data/zoteroseek.db"
    chroma_path: str = "./data/chroma"

    # Pydantic v2 配置
    model_config = {
        "env_prefix": "ZOTEROSEEK_",       # 环境变量前缀
        "env_file": str(ROOT_DIR / ".env"), # 自动加载 .env 文件
        "env_file_encoding": "utf-8",
    }

# 模块级单例 — 整个应用共享同一个 Settings 实例
settings = Settings()
```

### 3.2 配置加载优先级

Pydantic Settings 的值按以下优先级从高到低加载：

```
1. 运行时传入的参数（代码中直接赋值）
2. 环境变量（带 ZOTEROSEEK_ 前缀）
   例：ZOTEROSEEK_PORT=8080 → settings.port = 8080
3. .env 文件中的变量
   例：.env 文件中 ZOTEROSEEK_PORT=3000
4. 代码中的默认值
   例：port: int = 20801
```

### 3.3 类型校验机制

Pydantic v2 会对所有字段做运行时类型校验：

```python
# .env 中写了 ZOTEROSEEK_PORT=abc（非数字）
# → Pydantic 会抛出 ValidationError: "Input should be a valid integer"

# .env 中写了 ZOTEROSEEK_DEBUG=1（字符串 "1"）
# → Pydantic 自动转换为 bool True（类型强转）
```

---

## 四、文档摄入流水线（Ingestion Pipeline）

### 4.1 整体架构

这是 ZoteroSeek 最核心的模块，负责将原始 PDF 文档转换为可检索的向量数据。采用 **5 阶段管道模式**：

```
Source (PDF) ──→ Extract ──→ Parse ──→ Chunk ──→ Embed ──→ Store
  原始文件        提取文本      结构化解析    语义分块    向量化     持久化
```

### 4.2 Pipeline 编排器 (`backend/core/pipeline/ingestion.py`)

```python
import time
from typing import List
from backend.core.pipeline.interfaces import PipelineContext, PipelineResult
from backend.core.pipeline.parser import PipelineDocument
from backend.core.pipeline.chunker import SemanticChunker
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.vector_store import VectorStore
from backend.extractors.base import Extractor
from loguru import logger


class IngestionPipeline:
    """
    Document Ingestion Pipeline
    Source -> Extract -> Parse -> Chunk -> Embed -> Store

    设计模式：
    1. 管道模式（Pipeline Pattern）— 串联 5 个阶段
    2. 依赖注入（DI）— 所有组件通过构造函数注入，而非内部创建
    """

    # 依赖注入：每个参数都是一个实现特定接口的组件
    def __init__(
        self,
        extractor: Extractor,         # 文档提取器（MinerU / PyMuPDF）
        parser: PipelineDocument,     # 文档解析器（Markdown / 纯文本）
        chunker: SemanticChunker,     # 语义分块器
        embedder: EmbeddingClient,    # 嵌入向量客户端
        vector_store: VectorStore,    # 向量存储
    ):
        self.extractor = extractor
        self.parser = parser
        self.chunker = chunker
        self.embedder = embedder
        self.vector_store = vector_store

    async def ingest(self, ctx: PipelineContext) -> PipelineResult:
        """Execute full pipeline"""
        start = time.time()

        try:
            # ===== 阶段 1：提取（Extract）=====
            # 从 PDF 文件中提取文本 → RawContent 对象
            logger.info(f"[Pipeline] Extracting: {ctx.source_path}")
            raw = await self.extractor.extract(ctx.source_path)

            # ===== 阶段 2：解析（Parse）=====
            # RawContent → CanonicalDocument（结构化文档，含标题/章节/作者）
            logger.info(f"[Pipeline] Parsing: {ctx.item_id}")
            document = self.parser.parse(raw, ctx.item_id)

            # ===== 阶段 3：分块（Chunk）=====
            # CanonicalDocument → List[Chunk]（语义分块，每块 800 token）
            logger.info(f"[Pipeline] Chunking: {ctx.item_id}")
            chunks = self.chunker.chunk(document)

            if not chunks:
                return PipelineResult(
                    success=False, item_id=ctx.item_id,
                    error="No chunks created",
                    duration_ms=(time.time() - start) * 1000,
                )

            # ===== 阶段 4：嵌入（Embed）=====
            # 批量将文本块转为向量（减少 API 调用次数）
            logger.info(f"[Pipeline] Embedding {len(chunks)} chunks")
            texts = [c.content for c in chunks]
            embeddings = await self.embedder.embed(texts)
            for chunk, emb in zip(chunks, embeddings):
                chunk.embedding = emb

            # ===== 阶段 5：存储（Store）=====
            # upsert 语义：存在则更新，不存在则插入（幂等）
            logger.info(f"[Pipeline] Storing {len(chunks)} chunks")
            await self.vector_store.upsert(
                ids=[c.id for c in chunks],
                embeddings=[c.embedding for c in chunks],
                documents=[c.content for c in chunks],
                metadatas=[c.metadata.model_dump() for c in chunks],
            )

            elapsed = (time.time() - start) * 1000
            return PipelineResult(
                success=True, item_id=ctx.item_id,
                chunks_created=len(chunks), duration_ms=elapsed,
            )
        except Exception as e:
            # 统一异常处理：捕获任何阶段的异常，返回失败结果而非抛出
            logger.error(f"[Pipeline] Failed: {ctx.item_id} - {e}")
            return PipelineResult(
                success=False, item_id=ctx.item_id,
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )
```

### 4.3 PipelineContext 与 PipelineResult

```python
# backend/core/pipeline/interfaces.py
from pydantic import BaseModel
from typing import Optional

class PipelineContext(BaseModel):
    """流水线上下文 — 传入的输入参数"""
    item_id: str        # Zotero 文献 ID
    source_path: str    # PDF 文件路径
    content_hash: str = ""  # 内容哈希（用于增量更新检测）

class PipelineResult(BaseModel):
    """流水线结果 — 输出的执行报告"""
    success: bool
    item_id: str
    chunks_created: int = 0
    error: Optional[str] = None
    duration_ms: float = 0
```

### 4.4 API 调用入口 (`backend/api/index.py`)

```python
# 提取器注册表 — 工厂模式
EXTRACTORS = {
    "mineru": MinerUExtractor,
    "pymupdf": PDFExtractor,
}

def get_extractor(name: str):
    """根据名称获取提取器实例"""
    cls = EXTRACTORS.get(name)
    if not cls:
        raise ValueError(f"未知提取器: {name}，可选: {list(EXTRACTORS.keys())}")
    return cls()

@router.post("/index", response_model=IndexResponse)
async def index_pdf(request: IndexRequest):
    """索引 PDF 文件，支持选择提取器"""
    extractor = get_extractor(request.extractor)  # "mineru" | "pymupdf"
    await ensure_vector_store()  # 幂等初始化

    pipeline = IngestionPipeline(
        extractor=extractor,
        parser=parser,          # 共享单例
        chunker=chunker,        # 共享单例
        embedder=embedder,      # 共享单例
        vector_store=vector_store,  # 共享单例
    )

    ctx = PipelineContext(item_id=request.item_id, source_path=request.pdf_path)
    result = await pipeline.ingest(ctx)

    return IndexResponse(
        success=result.success,
        item_id=result.item_id,
        chunks_created=result.chunks_created,
        extractor_used=request.extractor,
    )
```

---

## 五、文档解析器（Document Parser）

### 5.1 设计目标

将提取器输出的 `RawContent`（原始文本）解析为 `CanonicalDocument`（结构化文档），支持两种输入格式：
- **Markdown**（MinerU 输出）：按 `#` 标题层级解析
- **纯文本**（PyMuPDF 输出）：按正则匹配学术论文分段

### 5.2 领域模型

```python
# backend/models/document.py
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from enum import Enum

class SectionType(str, Enum):
    """学术论文章节类型枚举"""
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

class DocumentSection(BaseModel):
    """文档章节 — 支持递归子章节"""
    heading: str
    section_type: SectionType = SectionType.UNKNOWN
    content: str
    level: int = 1                           # 标题层级（# = 1, ## = 2, ### = 3）
    subsections: List["DocumentSection"] = [] # 递归子章节（前向引用）
    citations: List[Citation] = []
    start_pos: int = 0
    end_pos: int = 0

class CanonicalDocument(BaseModel):
    """规范化文档 — 所有提取器的统一输出格式"""
    id: str
    title: str
    authors: List[str] = []
    abstract: Optional[str] = None
    year: Optional[int] = None
    doi: Optional[str] = None
    sections: List[DocumentSection] = []    # 结构化章节列表
    citations: List[Citation] = []
    raw_text: str                            # 原始全文（fallback 用）
    source_path: Optional[str] = None
    source_type: str = "pdf"                 # "pdf" | "markdown"
    page_count: int = 0
    metadata: Dict[str, Any] = {}

# 修复递归类型前向引用
DocumentSection.model_rebuild()
```

### 5.3 Markdown 解析流程 (`backend/core/pipeline/parser.py`)

```python
import re
from typing import List, Optional, Tuple
from backend.models.document import CanonicalDocument, DocumentSection, SectionType

class DocumentParser:
    """Markdown 感知的文档解析器"""

    # Markdown 标题正则：匹配 # Title / ## Section / ### Subsection
    MD_HEADER_PATTERN = re.compile(r"^(#{1,6})\s+(.+)$")

    # 学术论文分段关键词 → SectionType 映射
    SECTION_KEYWORDS = [
        ("abstract", SectionType.ABSTRACT),
        ("introduction", SectionType.INTRODUCTION),
        ("related work", SectionType.RELATED_WORK),
        ("method", SectionType.METHODS),
        ("methodology", SectionType.METHODS),
        ("experiment", SectionType.EXPERIMENTS),
        ("result", SectionType.RESULTS),
        ("conclusion", SectionType.CONCLUSION),
        ("reference", SectionType.REFERENCES),
        # ... 更多关键词
    ]

    def parse(self, raw: RawContent, item_id: str) -> CanonicalDocument:
        """根据 content_type 选择解析策略"""
        if raw.content_type == "markdown":
            return self._parse_markdown(raw, item_id)  # MinerU 输出
        else:
            return self._parse_plain(raw, item_id)     # PyMuPDF 输出

    def _classify_section(self, heading: str) -> SectionType:
        """根据标题文本匹配 SectionType"""
        heading_lower = heading.lower()
        for keyword, section_type in self.SECTION_KEYWORDS:
            if keyword in heading_lower:
                return section_type
        return SectionType.UNKNOWN
```

### 5.4 Markdown 章节拆分核心逻辑

```python
def _split_markdown_sections(self, text: str) -> List[DocumentSection]:
    """按 Markdown 标题拆分 sections，保留层级结构"""
    sections: List[DocumentSection] = []
    current_heading = None
    current_level = 0
    current_lines: List[str] = []

    for line in text.split("\n"):
        match = self.MD_HEADER_PATTERN.match(line.strip())

        if match:
            # 遇到新标题 → 保存之前积累的内容为一个 Section
            if current_heading is not None:
                content = "\n".join(current_lines).strip()
                section_type = self._classify_section(current_heading)
                sections.append(DocumentSection(
                    heading=current_heading,
                    section_type=section_type,
                    content=content,
                    level=current_level,
                ))
            current_heading = match.group(2).strip()     # 标题文本
            current_level = len(match.group(1))           # # = 1, ## = 2, ### = 3
            current_lines = []
        else:
            current_lines.append(line)  # 非标题行累积到当前 section

    # 保存最后一个 section
    if current_heading is not None:
        content = "\n".join(current_lines).strip()
        sections.append(DocumentSection(
            heading=current_heading,
            section_type=self._classify_section(current_heading),
            content=content,
            level=current_level,
        ))

    return sections
```

**解析结果示例**：

输入 Markdown：
```markdown
# Attention Is All You Need
## Abstract
The dominant sequence transduction models...
## 1 Introduction
Recurrent neural networks, long short-term memory...
## 2 Background
The goal of reducing sequential computation...
```

输出 `CanonicalDocument`：
```
CanonicalDocument(
    id="ABC123",
    title="Attention Is All You Need",
    sections=[
        DocumentSection(heading="Abstract", section_type="abstract", level=2, ...),
        DocumentSection(heading="1 Introduction", section_type="introduction", level=2, ...),
        DocumentSection(heading="2 Background", section_type="related_work", level=2, ...),
    ]
)
```

---

## 六、语义分块器（Semantic Chunker）

### 6.1 设计参数

```python
class SemanticChunker:
    """Markdown 感知的学术论文语义分块器"""

    def __init__(
        self,
        max_tokens: int = 800,      # 每个 Chunk 最大 token 数
        overlap_tokens: int = 100,   # 相邻 Chunk 的重叠 token 数
        min_chunk_tokens: int = 50,  # 最小 Chunk token 数（过小则合并）
    ):
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens
        self.min_chunk_tokens = min_chunk_tokens
```

**为什么选择 800 token + 100 token overlap？**
- 800 token 约为嵌入模型上下文窗口（8192）的 10%，避免语义稀释
- 100 token overlap 约为 12.5% 的重叠率，保证跨 chunk 边界的语义连续性
- 类比卷积神经网络中的滑动窗口思想

### 6.2 Token 估算

```python
def _estimate_tokens(self, text: str) -> int:
    """粗略估算 token 数：1 token ≈ 4 字符

    为什么用估算而非精确计算：
    - 精确计算需要加载 tokenizer（如 tiktoken），增加依赖和内存开销
    - 分块的目的不是精确到 token 级别，而是"大致不超限"
    - 对中文文本会偏低（中文每字约 2-3 token），但作为控制依据足够
    """
    return len(text) // 4
```

### 6.3 层次化分块策略

```python
def chunk(self, document: CanonicalDocument) -> List[Chunk]:
    """将文档按 sections 分块"""
    chunks: List[Chunk] = []
    idx = 0

    # 第一层：遍历文档的每个顶层 Section
    for section in document.sections:
        section_chunks = self._chunk_section(
            section, document, idx, [section.heading]
        )
        chunks.extend(section_chunks)
        idx += len(section_chunks)

    return chunks

def _chunk_section(
    self, section: DocumentSection, doc: CanonicalDocument,
    idx_start: int, heading_path: List[str],
) -> List[Chunk]:
    """分块单个 section（支持递归处理子 section）"""
    chunks: List[Chunk] = []
    text = section.content

    if not text.strip():
        return chunks

    # 快速路径：Section 整体在 token 限制内 → 直接作为一个 Chunk
    if self._estimate_tokens(text) <= self.max_tokens:
        if self._estimate_tokens(text.strip()) >= self.min_chunk_tokens:
            chunks.append(self._make_chunk(doc, idx_start, text, section, heading_path))
    else:
        # 慢路径：按段落拆分
        paragraphs = self._split_markdown_paragraphs(text)
        current: List[str] = []
        current_tokens = 0
        idx = idx_start

        for para in paragraphs:
            para_tokens = self._estimate_tokens(para)

            # 核心逻辑：加上当前段落会超限 → 保存已积累内容为 Chunk
            if current_tokens + para_tokens > self.max_tokens and current:
                chunk_text = "\n\n".join(current)
                if self._estimate_tokens(chunk_text.strip()) >= self.min_chunk_tokens:
                    chunks.append(self._make_chunk(doc, idx, chunk_text, section, heading_path))
                    idx += 1

                # Overlap：从上一个 Chunk 末尾取部分段落
                overlap = self._get_overlap(current)
                current = overlap
                current_tokens = sum(self._estimate_tokens(p) for p in overlap)

            current.append(para)
            current_tokens += para_tokens

        # 尾部内容
        if current:
            chunk_text = "\n\n".join(current)
            if self._estimate_tokens(chunk_text.strip()) >= self.min_chunk_tokens:
                chunks.append(self._make_chunk(doc, idx, chunk_text, section, heading_path))

    # 递归处理子 Section
    for sub in section.subsections:
        sub_chunks = self._chunk_section(
            sub, doc, idx_start + len(chunks), heading_path + [sub.heading]
        )
        chunks.extend(sub_chunks)

    return chunks
```

### 6.4 Markdown 感知的段落拆分

分块器使用**状态机**逐行扫描，确保表格、公式、代码块不会被切断：

```python
def _split_markdown_paragraphs(self, text: str) -> List[str]:
    """状态机拆分，保护特殊 Markdown 块的完整性"""
    blocks: List[str] = []
    current_block: List[str] = []
    in_math = False    # 公式块 $$...$$ 内部标记
    in_code = False    # 代码块 ```...``` 内部标记

    for line in text.split("\n"):
        stripped = line.strip()

        # 公式块边界检测（状态翻转）
        if stripped.startswith("$$"):
            if in_math:
                current_block.append(line)
                blocks.append("\n".join(current_block))
                current_block = []
                in_math = False
                continue
            elif not in_code:
                if current_block and not in_math:
                    blocks.append("\n".join(current_block))
                    current_block = []
                in_math = True

        # 代码块边界检测
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

        # 在特殊块内部，所有行直接累积，不做段落拆分
        if in_math or in_code:
            current_block.append(line)
            continue

        # 空行 = Markdown 段落分隔符
        if not stripped:
            if current_block:
                blocks.append("\n".join(current_block))
                current_block = []
            continue

        # 表格行合并：连续的 | 开头的行必须保持在一起
        if stripped.startswith("|"):
            if current_block and not current_block[-1].strip().startswith("|"):
                blocks.append("\n".join(current_block))
                current_block = []
            current_block.append(line)
            continue

        # 列表项合并
        if re.match(r"^(\-\s|\*\s|\d+\.\s)", stripped):
            if current_block and not re.match(r"^(\-\s|\*\s|\d+\.\s)", current_block[-1].strip()):
                blocks.append("\n".join(current_block))
                current_block = []
            current_block.append(line)
            continue

        current_block.append(line)

    if current_block:
        blocks.append("\n".join(current_block))

    return [b for b in blocks if b.strip()]
```

### 6.5 Overlap 策略

```python
def _get_overlap(self, paragraphs: List[str]) -> List[str]:
    """从后往前取段落，直到累计 token 达到 overlap_tokens

    为什么从后往前取：
    - 越靠近边界的段落，与下一个 Chunk 的语义关联性越强
    - 重叠的是完整的段落，不会从段落中间切断
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
```

### 6.6 Chunk 对象构造

```python
def _make_chunk(
    self, doc: CanonicalDocument, idx: int, content: str,
    section: DocumentSection, heading_path: List[str],
) -> Chunk:
    """创建 Chunk 对象，包含内容、元数据和唯一 ID"""
    content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]

    return Chunk(
        id=f"{doc.id}_{idx}",           # 唯一 ID = 文档ID_序号
        content=content,                 # 分块后的文本
        metadata=ChunkMetadata(
            item_id=doc.id,              # 所属文献 ID
            title=doc.title,             # 文献标题
            authors=doc.authors,         # 作者列表
            year=doc.year,               # 发表年份
            section_type=section.section_type.value,  # 章节类型
            heading_path=heading_path,   # 标题层级路径（如 ["Methods", "Setup"]）
            content_hash=content_hash,   # 内容哈希（用于去重和增量更新）
        ),
    )
```

---

## 七、RAG 系统（检索增强生成）

### 7.1 RAG 流程概览

```
用户提问："Transformer 的注意力机制是如何工作的？"
    │
    ▼
┌─────────────────────────────┐
│  1. Retriever.search()      │  将问题向量化 → ChromaDB 相似性搜索
│     query_embedding → top_k │
└─────────────┬───────────────┘
              │ 返回 top_k 个最相关的 Chunk
              ▼
┌─────────────────────────────┐
│  2. ChatIntegration         │  组装上下文 + 渲染 Prompt 模板
│     .augment_query()        │
└─────────────┬───────────────┘
              │ augmented_prompt（带上下文的 Prompt）
              ▼
┌─────────────────────────────┐
│  3. LLMClient.chat()        │  调用 LLM 生成回答（SSE 流式）
│     stream tokens →         │
└─────────────────────────────┘
```

### 7.2 向量检索器 (`backend/core/rag/retriever.py`)

```python
from typing import List, Optional
from backend.core.llm.embeddings import EmbeddingClient
from backend.data.vector_store import VectorStore, VectorResult

class Retriever:
    """语义检索器 — 将查询文本向量化，然后在向量数据库中搜索最近邻"""

    def __init__(self, embedder: EmbeddingClient, vector_store: VectorStore):
        self.embedder = embedder
        self.vector_store = vector_store

    async def search(
        self,
        query: str,
        top_k: int = 5,
        item_filter: Optional[str] = None,
    ) -> List[VectorResult]:
        """语义搜索流程：

        1. 调用 EmbeddingClient 将查询文本转为向量
        2. 可选：按 item_id 过滤（只搜索特定文献）
        3. 调用 VectorStore.query() 执行近似最近邻搜索
        """
        # 步骤 1：查询向量化
        query_embedding = await self.embedder.embed_single(query)

        # 步骤 2：构建过滤条件
        filters = {}
        if item_filter:
            filters["item_id"] = item_filter

        # 步骤 3：向量相似性搜索
        results = await self.vector_store.query(
            vector=query_embedding,
            top_k=top_k,
            filters=filters if filters else None,
        )

        return results
```

### 7.3 ChatIntegration — RAG 编排器 (`backend/core/rag/chat_integration.py`)

```python
from typing import List, Tuple
from backend.core.rag.retriever import Retriever
from backend.core.prompts.registry import PromptRegistry
from backend.data.vector_store import VectorResult

class ChatIntegration:
    """RAG 编排器 — 协调检索器和 Prompt 注册表"""

    def __init__(self, retriever: Retriever, prompt_registry: PromptRegistry):
        self.retriever = retriever
        self.prompt_registry = prompt_registry

    async def augment_query(
        self, query: str, top_k: int = 5
    ) -> Tuple[str, List[VectorResult]]:
        """RAG 三阶段：检索 → 上下文组装 → Prompt 渲染"""

        # ===== 阶段 1：检索 =====
        results = await self.retriever.search(query, top_k=top_k)

        if not results:
            # 无检索结果 → 退化为普通聊天
            return query, []

        # ===== 阶段 2：上下文组装 =====
        # 将检索到的 Chunk 格式化为带编号和来源标注的上下文
        # 编号 [1], [2], ... 使得 LLM 可以在回答中标注引用
        context_parts = []
        for i, result in enumerate(results, 1):
            source_info = result.metadata.get("title", "Unknown")
            section = result.metadata.get("section_type", "")
            context_parts.append(f"[{i}. {source_info} - {section}]\n{result.content}")

        context = "\n\n".join(context_parts)

        # ===== 阶段 3：Prompt 渲染 =====
        system, user = self.prompt_registry.render(
            "rag_research",
            context=context,
            question=query,
        )

        return user, results

    def format_sources(self, results: List[VectorResult]) -> str:
        """将检索结果格式化为可读的引用列表"""
        lines = []
        for i, result in enumerate(results, 1):
            title = result.metadata.get("title", "Unknown")
            section = result.metadata.get("section_type", "")
            score = result.score
            lines.append(f"[{i}] {title} ({section}) - Score: {score:.2f}")
        return "\n".join(lines)
```

**格式化输出示例**：
```
[1] Attention Is All You Need (abstract) - Score: 0.92
[2] BERT: Pre-training of Deep Bidirectional Transformers (introduction) - Score: 0.87
```

### 7.4 PromptRegistry — 提示词注册表 (`backend/core/prompts/registry.py`)

```python
from pydantic import BaseModel
from typing import Dict, List, Tuple

class PromptTemplate(BaseModel):
    """Prompt 模板定义"""
    name: str
    system: str         # 系统提示词（角色设定 + 行为准则）
    template: str       # 用户提示词模板（含占位符 {context}、{question} 等）
    variables: List[str] = []  # 模板变量列表
    description: str = ""

class PromptRegistry:
    """Prompt 模板注册表 — 集中管理所有 Prompt 模板"""

    def __init__(self):
        self._prompts: Dict[str, PromptTemplate] = {}
        self._register_defaults()  # 注册内置模板

    def register(self, prompt: PromptTemplate):
        """注册一个 Prompt 模板"""
        self._prompts[prompt.name] = prompt

    def get(self, name: str) -> PromptTemplate:
        """获取模板（不存在则抛异常）"""
        if name not in self._prompts:
            raise ValueError(f"Prompt not found: {name}")
        return self._prompts[name]

    def render(self, name: str, **kwargs) -> Tuple[str, str]:
        """渲染模板：替换占位符，返回 (system_prompt, user_prompt)"""
        template = self.get(name)
        content = template.template
        for var in template.variables:
            if var in kwargs:
                content = content.replace(f"{{{var}}}", str(kwargs[var]))
        return template.system, content

    def _register_defaults(self):
        """注册内置模板"""
        self.register(PromptTemplate(
            name="rag_research",
            system="""You are ZoteroSeek, an AI research assistant.

Rules:
1. ALWAYS respond in the SAME LANGUAGE as the user's question.
2. If context from papers is provided, cite with [^N^] format.
3. If NO relevant context is provided, answer naturally. Do NOT invent references.
4. Be helpful, precise, and concise. Preserve technical terminology.""",
            template="""### Context from Papers:

{context}

### Question:
{question}

### Answer:""",
            variables=["context", "question"],
        ))
```

**渲染过程示例**：
```python
system, user = registry.render(
    "rag_research",
    context="[1. Attention Is All You Need - abstract]\nThe dominant...",
    question="What is self-attention?",
)
# system = "You are ZoteroSeek, an AI research assistant..."
# user = "### Context from Papers:\n\n[1. Attention Is All You You Need - abstract]\nThe dominant...\n\n### Question:\nWhat is self-attention?\n\n### Answer:"
```

---

## 八、数据层

### 8.1 抽象接口：VectorStore (`backend/data/vector_store.py`)

```python
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class VectorResult(BaseModel):
    """向量查询结果"""
    id: str
    content: str
    metadata: Dict[str, Any]
    score: float = 0.0

class VectorStore(ABC):
    """向量存储抽象基类 — 定义统一接口

    设计模式：适配器模式（Adapter Pattern）
    - 具体实现类（如 ChromaVectorStore）只需实现这 5 个抽象方法
    - 切换向量数据库时，只需新增实现类，不修改业务代码
    """

    @abstractmethod
    async def initialize(self, collection_name: str, dimension: int) -> None: ...

    @abstractmethod
    async def upsert(self, ids: List[str], embeddings: List[List[float]],
                     documents: List[str], metadatas: List[Dict[str, Any]]) -> None: ...

    @abstractmethod
    async def query(self, vector: List[float], top_k: int = 5,
                    filters: Optional[Dict[str, Any]] = None) -> List[VectorResult]: ...

    @abstractmethod
    async def delete_by_item(self, item_id: str) -> int: ...

    @abstractmethod
    async def count(self) -> int: ...
```

### 8.2 ChromaDB 实现 (`backend/data/chroma_store.py`)

```python
import chromadb
from chromadb.config import Settings
from typing import List, Optional, Dict, Any
from backend.data.vector_store import VectorStore, VectorResult
from backend.config.settings import settings

class ChromaVectorStore(VectorStore):
    """ChromaDB 向量存储实现

    关键技术点：
    - 持久化存储：PersistentClient，数据保存在本地磁盘
    - 余弦相似度：hnsw:space = cosine
    - HNSW 索引：高效近似最近邻搜索算法
    """

    def __init__(self, persist_directory: str = None):
        self.persist_directory = persist_directory or settings.chroma_path
        self.client = None
        self.collection = None

    async def initialize(self, collection_name: str = "research", dimension: int = 1536) -> None:
        """初始化 ChromaDB"""
        # PersistentClient：数据持久化到本地磁盘
        # anonymized_telemetry=False：禁用匿名遥测，保护隐私
        self.client = chromadb.PersistentClient(
            path=self.persist_directory,
            settings=Settings(anonymized_telemetry=False),
        )
        # get_or_create_collection：幂等初始化
        # hnsw:space=cosine：使用余弦距离（cosine distance）
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    async def upsert(self, ids, embeddings, documents, metadatas) -> None:
        """upsert = update + insert（幂等语义）

        存储四维度：
        - ids: 唯一标识（主键）
        - embeddings: 向量（用于相似性搜索）
        - documents: 原始文本（检索后返回给用户）
        - metadatas: 结构化元数据（支持 where 条件过滤）
        """
        if not ids:
            return
        self.collection.upsert(
            ids=ids, embeddings=embeddings,
            documents=documents, metadatas=metadatas,
        )

    async def query(self, vector, top_k=5, filters=None) -> List[VectorResult]:
        """查询最相似的 top_k 个向量

        距离 → 相似度转换：
        - ChromaDB 返回余弦距离（cosine distance），范围 [0, 2]
        - 余弦相似度 = 1 - 余弦距离，范围 [-1, 1]
        - score 越接近 1，表示越相关
        """
        results = self.collection.query(
            query_embeddings=[vector],
            n_results=top_k,
            where=filters if filters else None,
            include=["documents", "metadatas", "distances"],
        )

        return [
            VectorResult(
                id=results["ids"][0][i],
                content=results["documents"][0][i],
                metadata=results["metadatas"][0][i],
                score=1 - results["distances"][0][i],  # cosine distance → similarity
            )
            for i in range(len(results["ids"][0]))
        ]

    async def delete_by_item(self, item_id: str) -> int:
        """按文献 ID 删除所有关联向量"""
        results = self.collection.get(where={"item_id": item_id}, include=[])
        if results["ids"]:
            self.collection.delete(ids=results["ids"])
        return len(results["ids"])
```

### 8.3 SQLite + SQLAlchemy ORM (`backend/data/db.py` + `backend/data/models.py`)

**引擎配置**：

```python
# backend/data/db.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from backend.config.settings import settings
from pathlib import Path

# 确保数据目录存在
db_path = Path(settings.sqlite_path)
db_path.parent.mkdir(parents=True, exist_ok=True)

# 创建引擎（echo=False 生产环境不打印 SQL）
engine = create_engine(f"sqlite:///{settings.sqlite_path}", echo=False)

# 会话工厂
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    """SQLAlchemy 2.0 声明式基类"""
    pass

def get_db():
    """FastAPI 依赖注入用的数据库会话生成器"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """创建所有表（启动时调用）"""
    from backend.data.models import Item  # noqa: F401 — 触发 ORM 注册
    Base.metadata.create_all(bind=engine)
```

**ORM 模型**：

```python
# backend/data/models.py
from sqlalchemy import Column, String, Integer, DateTime, Text
from sqlalchemy.sql import func
from backend.data.db import Base

class Item(Base):
    """文献条目表 — 记录每篇被索引的文献的元数据和索引状态"""
    __tablename__ = "items"

    id = Column(String, primary_key=True)          # Zotero item key
    title = Column(String, nullable=False)
    authors = Column(Text)                          # JSON 数组存储
    year = Column(Integer)
    abstract = Column(Text)
    pdf_path = Column(String)

    # 索引状态追踪
    index_status = Column(String, default="pending")
    # 状态机: pending → extracting → chunking → embedding → indexed
    #                                              ↘ error
    index_error = Column(Text)
    content_hash = Column(String)                   # 用于增量更新检测
    embedding_model = Column(String)
    embedding_dimension = Column(Integer)

    # 时间戳
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

### 8.4 数据层架构对比

```
┌───────────────────────────────────────────────────────────┐
│                     应用层 (API / Core)                    │
├─────────────────────────┬─────────────────────────────────┤
│    向量存储 (检索用)      │    关系存储 (元数据用)            │
│                         │                                 │
│  VectorStore (ABC)      │  SQLAlchemy ORM                 │
│    │                    │    │                            │
│    └─ ChromaVectorStore │    └─ Item 表                   │
│       (HNSW + cosine)   │       (SQLite)                 │
│                         │                                 │
│  存储内容：              │  存储内容：                       │
│  - 向量 (embedding)     │  - 文献元数据 (title/authors)    │
│  - 文本 (document)      │  - 索引状态 (index_status)      │
│  - 元数据 (metadata)    │  - 文件路径 (pdf_path)           │
│                         │  - 时间戳 (created_at/updated_at)│
└─────────────────────────┴─────────────────────────────────┘
```

---

## 九、提取器（Extractors）

### 9.1 抽象接口 (`backend/extractors/base.py`)

```python
from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import Any, Dict

class RawContent(BaseModel):
    """提取结果的标准化数据契约 — 连接"提取阶段"和"解析阶段"的桥梁"""
    content: str                          # 提取的文本内容
    content_type: str                     # "pdf" | "markdown" | "html"
    metadata: Dict[str, Any] = {}         # 提取过程的额外信息
    page_count: int = 0
    source_path: str = ""

class Extractor(ABC):
    """提取器抽象基类

    为什么用 ABC 而非普通基类：
    - @abstractmethod 在实例化时检查，未实现则直接 TypeError（Fail-Fast）
    - 普通基类的方法不重写只在运行时才发现逻辑错误
    """

    @abstractmethod
    async def extract(self, source: str, config: Dict[str, Any] = None) -> RawContent:
        """从文件中提取文本内容"""
        ...

    @abstractmethod
    def supports(self, source_type: str) -> bool:
        """检查是否支持该文件类型"""
        ...
```

### 9.2 MinerU 提取器 — 云端 4 步异步 API (`backend/extractors/mineru_extractor.py`)

MinerU 使用深度学习模型进行版面分析，能准确识别标题层级、表格结构、数学公式、页眉页脚。

```
┌──────────────────────────────────────────────────────────────────┐
│                    MinerU Agent API 4 步流程                      │
│                                                                  │
│  步骤 1: POST /api/v1/agent/parse/file                          │
│          提交解析任务 → 返回 task_id + upload_url (OSS 预签名)     │
│                          │                                       │
│  步骤 2: PUT upload_url  │                                       │
│          上传 PDF 到对象存储（预签名 URL，无需额外认证）            │
│                          │                                       │
│  步骤 3: GET /api/v1/agent/parse/{task_id}  ← 轮询              │
│          每 3 秒查询一次，直到 state=done → 获取 markdown_url      │
│          超时保护：最多 120 秒                                    │
│                          │                                       │
│  步骤 4: GET markdown_url                                       │
│          从 CDN 下载解析后的 Markdown 内容                        │
└──────────────────────────────────────────────────────────────────┘
```

**核心实现**：

```python
import asyncio
import httpx
from pathlib import Path
from backend.extractors.base import Extractor, RawContent
from backend.config.settings import settings

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB（API 硬性限制）
MAX_PAGES = 20                     # 最多 20 页

class MinerUExtractor(Extractor):
    """MinerU 云端 API 提取器（4 步异步流程）"""

    def __init__(self):
        self.base_url = (
            settings.mineru_api_url.rstrip("/")
            if settings.mineru_api_url
            else "https://mineru.net"
        )
        self.api_key = settings.mineru_api_key
        self.language = settings.mineru_language

    async def extract(self, source: str, config=None) -> RawContent:
        source_path = Path(source)
        if not source_path.exists():
            raise FileNotFoundError(f"PDF 文件不存在: {source}")

        # 预检查：文件大小限制（在发起网络请求前就检查）
        file_size = source_path.stat().st_size
        if file_size > MAX_FILE_SIZE:
            raise ValueError(f"PDF 文件过大（{file_size/1024/1024:.1f}MB），请使用 pymupdf 提取器")

        pdf_bytes = source_path.read_bytes()

        # HTTP 客户端配置
        timeout = httpx.Timeout(connect=30, read=120, write=120, pool=30)
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            # 步骤 1：提交任务
            task_id, upload_url = await self._submit_task(client, source_path.name, headers)

            # 步骤 2：上传 PDF
            await self._upload_file(client, upload_url, pdf_bytes)

            # 步骤 3：轮询结果（每 3 秒，最多 120 秒）
            markdown_url = await self._poll_result(client, task_id, headers)

            # 步骤 4：下载 Markdown
            markdown = await self._download_markdown(client, markdown_url, headers)

            return RawContent(
                content=markdown,
                content_type="markdown",
                page_count=0,
                source_path=source,
                metadata={"extractor": "mineru", "file_size": file_size},
            )

    async def _poll_result(self, client, task_id, headers,
                           poll_interval=3.0, max_wait=120.0) -> str:
        """轮询任务结果

        状态机：
        - "done" → 返回 markdown_url
        - "failed"/"error" → 抛出异常
        - 其他（pending/processing）→ 继续等待
        """
        url = f"{self.base_url}/api/v1/agent/parse/{task_id}"
        elapsed = 0.0

        while elapsed < max_wait:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            state = data.get("data", {}).get("state", "")

            if state == "done":
                return data["data"]["markdown_url"]
            elif state in ("failed", "error"):
                error = data.get("data", {}).get("err_msg", "未知错误")
                raise RuntimeError(f"MinerU 解析失败: {error}")

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(f"MinerU 任务超时（{max_wait}s）: {task_id}")

    def supports(self, source_type: str) -> bool:
        return source_type.lower() == "pdf"
```

### 9.3 PyMuPDF 提取器 — 本地同步转异步 (`backend/extractors/pdf.py`)

```python
import asyncio
import fitz  # PyMuPDF
from backend.extractors.base import Extractor, RawContent

class PDFExtractor(Extractor):
    """PyMuPDF 本地 PDF 提取器

    关键技术点：
    - fitz.open() / page.get_text() 是同步阻塞调用
    - 必须用 asyncio.to_thread() 包裹，否则会阻塞 FastAPI 事件循环
    - 导致其他并发请求卡住（FastAPI 是单线程事件循环模型）
    """

    async def extract(self, source: str, config=None) -> RawContent:
        # 将阻塞调用放到线程池中执行，不阻塞事件循环
        full_text, page_count = await asyncio.to_thread(
            self._extract_sync, source
        )

        return RawContent(
            content=full_text,
            content_type="pdf",          # 纯文本类型（非 Markdown）
            page_count=page_count,
            source_path=source,
            metadata={"pages": page_count},
        )

    @staticmethod
    def _extract_sync(source: str) -> tuple[str, int]:
        """同步提取 PDF 文本（在线程池中运行）"""
        doc = fitz.open(source)
        pages = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                pages.append(text)
        doc.close()
        return "\n\n".join(pages), len(pages)

    def supports(self, source_type: str) -> bool:
        return source_type.lower() == "pdf"
```

### 9.4 两种提取器对比

| 维度 | MinerU (MinerUExtractor) | PyMuPDF (PDFExtractor) |
|---|---|---|
| **运行环境** | 云端 API | 本地 |
| **输出格式** | 结构化 Markdown | 纯文本 |
| **异步模型** | 原生 async（httpx 异步请求） | asyncio.to_thread()（同步转异步） |
| **版面分析** | 深度学习模型（识别标题/表格/公式） | 无（只提取文本层） |
| **限制** | 10MB / 20 页 | 无 |
| **适用场景** | 学术论文（需要结构化信息） | 大文件 / 简单文档 / 离线环境 |
| **content_type** | `"markdown"` → Parser 走 Markdown 解析 | `"pdf"` → Parser 走纯文本正则匹配 |

---

## 十、SSE 流式响应（Server-Sent Events）

### 10.1 chat.py 的 SSE 流式实现

```python
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.agent.graph import get_agent

router = APIRouter(tags=["chat"])

class ChatRequest(BaseModel):
    message: str
    top_k: int = 5

@router.post("/chat")
async def chat(request: ChatRequest):
    """RAG Agent Chat — SSE 流式响应"""
    agent = get_agent()

    async def generate():
        """SSE 事件生成器（异步生成器函数）"""
        sources = []
        try:
            # astream_events 是 LangGraph 的流式 API
            async for event in agent.astream_events(
                {"messages": [("human", request.message)]},
                version="v2",
            ):
                kind = event.get("event", "")

                # LLM token 流 → 前端逐字显示
                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and chunk.content:
                        yield f"data: {chunk.content}\n\n"

                # 工具调用结果 → 收集为引用来源
                elif kind == "on_tool_end":
                    tool_name = event.get("name", "")
                    tool_output = event.get("data", {}).get("output", "")
                    if tool_name == "search_knowledge" and tool_output:
                        sources.append({
                            "tool": tool_name,
                            "output_preview": tool_output[:300],
                        })

        except Exception as e:
            yield f"data: [Error: {str(e)}]\n\n"

        # 发送引用来源和结束标记
        if sources:
            yield f"sources: {json.dumps(sources, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

### 10.2 SSE 协议格式

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: Transformer
data:  的注意力
data: 机制
data: 通过
data: Query
data: -Key
data: -Value
data: 矩阵
data: 计算
data: ...

sources: [{"tool": "search_knowledge", "output_preview": "..."}]

data: [DONE]

```

**SSE 事件类型**：

| 前缀 | 含义 | 时机 |
|---|---|---|
| `data: {chunk}` | LLM 输出的每个 token | 每收到一个 token 就发送 |
| `sources: {json}` | 检索引用来源 | LLM 生成完毕后发送一次 |
| `data: [DONE]` | 流结束标记 | 最后发送，前端据此关闭连接 |

### 10.3 StreamingResponse 工作原理

```
客户端 POST /api/v1/chat
    │
    ▼
FastAPI 路由函数返回 StreamingResponse
    │
    ├─ StreamingResponse 接收一个 async generator（generate()）
    │
    ├─ FastAPI 将 generator 包装为 ASGI 响应
    │
    ├─ 每次 generator yield 一个字符串，立即发送到客户端
    │  （不会等所有数据生成完才发送 — 这就是"流式"的关键）
    │
    ├─ Content-Type: text/event-stream
    │  告诉浏览器这是一个 SSE 流，可以用 EventSource API 接收
    │
    └─ generator 结束 → HTTP 连接关闭
```

### 10.4 LLM 流式客户端 (`backend/core/llm/client.py`)

```python
import httpx
import json
from typing import List, Dict, AsyncGenerator
from backend.config.settings import settings

class LLMClient:
    """OpenAI 兼容的 LLM 客户端 — 支持流式和非流式"""

    def __init__(self, api_key=None, base_url=None, model=None):
        self.api_key = api_key or settings.llm_api_key
        self.base_url = base_url or settings.llm_base_url
        self.model = model or settings.llm_model

    async def chat(
        self, messages: List[Dict[str, str]], stream: bool = True
    ) -> AsyncGenerator[str, None]:
        """流式聊天 — 逐 token 返回"""
        async with httpx.AsyncClient() as client:
            if stream:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "messages": messages,
                        "stream": True,
                    },
                    timeout=120.0,
                ) as response:
                    response.raise_for_status()

                    # 逐行解析 SSE 流（OpenAI 格式）
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        if line.startswith("data: "):
                            data = line[6:]
                            if data.strip() == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                                delta = chunk["choices"][0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield content  # 每个 token yield 一次
                            except (json.JSONDecodeError, IndexError, KeyError):
                                continue
            else:
                # 非流式：一次性返回完整响应
                response = await client.post(...)
                result = response.json()
                yield result["choices"][0]["message"]["content"]
```

**双层 SSE 流式架构**：

```
LLM API (OpenAI 兼容)             ZoteroSeek 后端              前端浏览器
─────────────────               ────────────────              ──────────
data: {"choices":[{"delta":{"content":"Transformer"}}]}
    │                               │
    └─ httpx.stream() ─────→  LLMClient.chat() ────→  SSE chunk: "Transformer"
                                           yield          │
data: {"choices":[{"delta":{"content":" 的"}}]}           │
    │                               │                     │
    └─────────────────────→  yield " 的" ─────────→  SSE chunk: " 的"
                                           │
data: [DONE]                               │
    │                               │                     │
    └─────────────────────→  break ───→  yield "[DONE]" → 流结束
```

---

## 十一、共享依赖管理 (`backend/api/shared_deps.py`)

### 11.1 模块级单例模式

```python
from backend.core.llm.embeddings import EmbeddingClient
from backend.core.llm.client import LLMClient
from backend.core.prompts.registry import PromptRegistry
from backend.data.chroma_store import ChromaVectorStore
from backend.core.pipeline.parser import DocumentParser
from backend.core.pipeline.chunker import SemanticChunker

# 模块级单例 — 整个应用生命周期共享
# Python 模块只会被 import 一次（之后都是从 sys.modules 缓存中取）
# 因此这些实例在进程内是全局唯一的
embedder = EmbeddingClient()
llm_client = LLMClient()
prompt_registry = PromptRegistry()
vector_store = ChromaVectorStore()
parser = DocumentParser()
chunker = SemanticChunker()

# 向量存储初始化状态标记
_vector_store_initialized = False

async def ensure_vector_store():
    """确保向量存储已初始化（幂等，只初始化一次）

    为什么需要这个函数？
    - ChromaDB 的 initialize() 会创建/打开本地数据库文件
    - 不应在模块导入时执行（可能导入但不使用）
    - 使用 _vector_store_initialized 标记确保只初始化一次
    """
    global _vector_store_initialized
    if not _vector_store_initialized:
        await vector_store.initialize()
        _vector_store_initialized = True
```

### 11.2 单例生命周期

```
进程启动
    │
    ├─ import backend.api.shared_deps
    │      │
    │      ├─ embedder = EmbeddingClient()        # 创建实例（不发起网络请求）
    │      ├─ llm_client = LLMClient()             # 创建实例
    │      ├─ prompt_registry = PromptRegistry()   # 注册内置 Prompt 模板
    │      ├─ vector_store = ChromaVectorStore()   # 创建实例（不连接数据库）
    │      ├─ parser = DocumentParser()            # 创建实例
    │      └─ chunker = SemanticChunker()          # 创建实例
    │
    ▼
第一次请求到来（如 /api/v1/index）
    │
    ├─ ensure_vector_store()
    │      └─ vector_store.initialize()   # 创建 ChromaDB 客户端 + Collection
    │
    ▼
后续所有请求复用同一个 vector_store 实例
```

---

## 十二、Embedding 客户端 (`backend/core/llm/embeddings.py`)

```python
import httpx
from typing import List
from backend.config.settings import settings

class EmbeddingClient:
    """OpenAI 兼容的 Embedding 客户端

    关键设计：分批发送（batch processing）
    - Embedding API 有单次请求的 token/数量上限
    - 一次发送过多文本可能触发 400/413 错误
    - 分批发送更稳定，也便于控制并发
    """

    def __init__(self, api_key=None, base_url=None, model=None, batch_size=20):
        self.api_key = api_key or settings.embedding_api_key
        self.base_url = base_url or settings.embedding_base_url
        self.model = model or settings.embedding_model
        self.batch_size = batch_size  # 每批最多 20 条

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """批量生成 Embedding 向量"""
        if not texts:
            return []

        all_embeddings: List[List[float]] = []

        # 分批发送
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={"model": self.model, "input": batch},
                    timeout=60.0,
                )
                response.raise_for_status()
                data = response.json()

            batch_embeddings = [item["embedding"] for item in data["data"]]
            all_embeddings.extend(batch_embeddings)

        return all_embeddings

    async def embed_single(self, text: str) -> List[float]:
        """单条文本 Embedding（内部复用 embed()）"""
        results = await self.embed([text])
        return results[0]
```

**分批流程图**：

```
输入: 45 条文本, batch_size = 20

批次 1: texts[0:20]   → POST /embeddings → 20 个向量
批次 2: texts[20:40]  → POST /embeddings → 20 个向量
批次 3: texts[40:45]  → POST /embeddings →  5 个向量

输出: 45 个向量
```

---

## 十三、完整数据流：从 PDF 到智能问答

```
                        ┌─────────────────────────────┐
                        │    用户上传 PDF（/index）     │
                        └──────────────┬──────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        │  IngestionPipeline.ingest()  │
                        │                              │
                        │  1. Extract                  │
                        │     MinerUExtractor          │
                        │       → 4 步 API → Markdown  │
                        │     PDFExtractor             │
                        │       → PyMuPDF → 纯文本     │
                        │                              │
                        │  2. Parse                    │
                        │     DocumentParser           │
                        │       → CanonicalDocument    │
                        │       (标题/作者/章节/摘要)   │
                        │                              │
                        │  3. Chunk                    │
                        │     SemanticChunker          │
                        │       → List[Chunk]          │
                        │       (800 token, 100 overlap)│
                        │                              │
                        │  4. Embed                    │
                        │     EmbeddingClient          │
                        │       → List[List[float]]    │
                        │       (text-embedding-3-small)│
                        │                              │
                        │  5. Store                    │
                        │     ChromaVectorStore.upsert │
                        │       → ChromaDB 持久化      │
                        └──────────────────────────────┘

                        ┌──────────────────────────────┐
                        │  用户提问（/chat）             │
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  LangGraph Agent              │
                        │                              │
                        │  工具：                       │
                        │  - search_knowledge          │
                        │    Retriever.search()        │
                        │      → EmbeddingClient.embed_single()
                        │      → ChromaVectorStore.query(cosine)
                        │      → top_k 结果            │
                        │                              │
                        │  LLM 流式输出：               │
                        │    astream_events()          │
                        │      → on_chat_model_stream  │
                        │      → yield token           │
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  SSE StreamingResponse        │
                        │                              │
                        │  data: {token}               │
                        │  sources: [{...}]            │
                        │  data: [DONE]                │
                        └──────────────────────────────┘
```

---

## 12. LangChain 生态集成

### 架构演进

```
之前：手写 EmbeddingClient (httpx) + 手写 ChromaVectorStore (适配器)
之后：LangChain OpenAIEmbeddings + LangChain Chroma（统一接口）
保留：自研 SemanticChunker + DocumentParser（LangChain 替代方案不支持 Markdown 感知）
```

### 为什么保留自研 Chunker 和 Parser？

| 组件 | LangChain 方案 | 自研方案 | 选择 |
|------|---------------|----------|------|
| Embedding | `OpenAIEmbeddings` | 手写 httpx 60 行 | ✅ LangChain（标准化接口） |
| VectorStore | `langchain_chroma.Chroma` | 手写适配器 70 行 | ✅ LangChain（自动持久化） |
| Chunker | `RecursiveCharacterTextSplitter` | Markdown 感知状态机 | ✅ 自研（保护表格/公式） |
| Parser | 无直接替代 | Markdown + 纯文本双模式 | ✅ 自研（学术分段识别） |

### 适配器模式

```python
# backend/core/llm/adapters.py

class EmbeddingsAdapter:
    """将 LangChain OpenAIEmbeddings 适配为 Pipeline 接口"""
    def __init__(self, langchain_embeddings):
        self._embeddings = langchain_embeddings

    async def embed(self, texts: List[str]) -> List[List[float]]:
        return await asyncio.to_thread(self._embeddings.embed_documents, texts)

    async def embed_single(self, text: str) -> List[float]:
        return await asyncio.to_thread(self._embeddings.embed_query, text)

class VectorStoreAdapter:
    """将 LangChain Chroma 适配为 Pipeline 接口"""
    def __init__(self, langchain_vectorstore):
        self._vs = langchain_vectorstore

    async def upsert(self, ids, embeddings, documents, metadatas):
        await asyncio.to_thread(self._vs._collection.upsert, ...)

    async def query(self, vector, top_k, filters):
        # 返回 VectorResult 列表
```

### shared_deps.py 初始化

```python
# LangChain 原生组件
lc_embeddings = OpenAIEmbeddings(
    api_key=settings.embedding_api_key,
    base_url=settings.embedding_base_url,
    model=settings.embedding_model,
)
lc_vectorstore = Chroma(
    collection_name="research",
    embedding_function=lc_embeddings,
    persist_directory=settings.chroma_path,
)

# 适配器（供 IngestionPipeline 使用）
embedder = EmbeddingsAdapter(lc_embeddings)
vector_store = VectorStoreAdapter(lc_vectorstore)

# 自研组件（保留）
parser = DocumentParser()
chunker = SemanticChunker()
```
