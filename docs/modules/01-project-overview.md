# ZoteroSeek 项目概述文档

> **文档版本**: v1.0 | **最后更新**: 2026-06-09
> **项目状态**: Beta（架构冻结，分离架构 2.0）
> **开源协议**: AGPL-3.0

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构图](#2-系统架构图)
3. [技术选型对比](#3-技术选型对比)
4. [三大组件职责](#4-三大组件职责)
5. [关键设计决策](#5-关键设计决策)
6. [环境配置](#6-环境配置)

---

## 1. 项目概述

### 1.1 什么是 ZoteroSeek

ZoteroSeek 是一个**本地优先（local-first）的 AI 学术研究助手**，以 Zotero 文献管理器为入口，通过 RAG（Retrieval-Augmented Generation）技术实现对用户文献库的语义检索和智能问答。

简单来说：**用户可以像聊天一样向自己的文献库提问，系统自动检索相关论文片段并给出引用答案。**

### 1.2 解决的核心问题

| 痛点 | 传统方式 | ZoteroSeek 方案 |
|------|----------|-----------------|
| 查找文献中的关键信息 | 手动翻阅 PDF，Ctrl+F 关键词搜索 | 自然语言提问，语义检索最相关片段 |
| 跨文献对比分析 | 打开多篇 PDF 逐一比对 | 一次提问检索多篇文献的相关内容 |
| 理解复杂学术概念 | 搜索引擎 + 反复阅读 | AI 基于文献上下文直接解释 |
| 文献知识无法积累 | 知识停留在人脑中 | 向量化存储，构建可检索的个人知识库 |
| 现有 AI 工具的隐私问题 | 数据上传到第三方云服务 | 全部本地运行，数据不离开用户设备 |

### 1.3 目标用户

- **科研人员/研究生/博士生**：需要大量阅读和管理学术文献
- **需要跨文献检索和对比分析的研究者**
- **希望利用 AI 提升研究效率但担心数据隐私的学者**

### 1.4 核心功能

1. **RAG 语义检索**：将 PDF 论文解析、分块、向量化，支持自然语言语义搜索
2. **智能对话（Agent）**：基于 LangGraph ReAct Agent，LLM 自主决定是否调用工具（搜索/查询/索引）
3. **PDF 智能解析**：MinerU 深度学习版面分析，准确识别标题层级、表格、公式、代码块
4. **流式对话**：SSE（Server-Sent Events）实时流式返回，打字机效果
5. **多模型支持**：兼容 OpenAI 接口协议，支持 GPT-4o、DeepSeek、MiMo 等
6. **文献库管理**：通过 Zotero Web API 读取文献库，支持批量索引

---

## 2. 系统架构图

### 2.1 整体分离架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         用户界面层 (Presentation Layer)                      │
│                                                                             │
│   ┌──────────────────────┐         ┌──────────────────────────────┐        │
│   │   Zotero Plugin      │         │   Browser (React UI)         │        │
│   │   (极薄桥接层)         │         │   http://localhost:20801     │        │
│   │                      │         │                              │        │
│   │  - launcher.ts       │         │  - Chat.tsx (对话视图)        │        │
│   │  - bridge.ts (HTTP)  │         │  - Library.tsx (文献库视图)    │        │
│   │  - prefs.ts          │         │  - Search.tsx (搜索视图)      │        │
│   │  - bootstrap.js      │         │  - SessionSidebar.tsx        │        │
│   │                      │         │                              │        │
│   │  TypeScript          │         │  React 18 + TypeScript       │        │
│   │  zotero-plugin-      │         │  Tailwind CSS + Zustand      │        │
│   │  scaffold            │         │  Vite + esbuild              │        │
│   └──────────┬───────────┘         └──────────────┬───────────────┘        │
│              │                                     │                        │
└──────────────┼─────────────────────────────────────┼────────────────────────┘
               │ HTTP (fetch)                        │ HTTP/SSE (fetch + ReadableStream)
               │                                     │
               ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Python Backend  (FastAPI + Uvicorn)                       │
│                    http://localhost:20801                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       API Layer (FastAPI Router)                     │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐   │   │
│  │  │ /health  │ │ /chat    │ │ /index   │ │/search │ │ /library │   │   │
│  │  │ 健康检查  │ │ SSE 流式 │ │ PDF 索引  │ │语义搜索│ │ 文献列表  │   │   │
│  │  └──────────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ └──────────┘   │   │
│  │                    │            │            │                      │   │
│  └────────────────────┼────────────┼────────────┼──────────────────────┘   │
│                       │            │            │                            │
│                       ▼            ▼            ▼                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Agent Layer (LangGraph)                          │   │
│  │                                                                      │   │
│  │   ┌──────────────────────────────────────────┐                      │   │
│  │   │        ReAct Agent (create_react_agent)   │                      │   │
│  │   │                                          │                      │   │
│  │   │  User Query → LLM 思考 → 需要工具?       │                      │   │
│  │   │       │              │                    │                      │   │
│  │   │       │ No           │ Yes                │                      │   │
│  │   │       ▼              ▼                    │                      │   │
│  │   │   直接回答      调用工具 → 获取结果        │                      │   │
│  │   │                    │                     │                      │   │
│  │   │                    ▼                     │                      │   │
│  │   │              继续思考/回答                 │                      │   │
│  │   └──────────────────────────────────────────┘                      │   │
│  │                                                                      │   │
│  │   ┌────────────┐  ┌──────────────┐  ┌───────────────┐              │   │
│  │   │search_     │  │query_library │  │index_document │              │   │
│  │   │knowledge   │  │              │  │               │              │   │
│  │   │(语义搜索)   │  │(文献列表查询) │  │(PDF索引)      │              │   │
│  │   └────────────┘  └──────────────┘  └───────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                       │                                                     │
│                       ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Core Layer (核心处理逻辑)                          │   │
│  │                                                                      │   │
│  │   Ingestion Pipeline (文档摄入流水线):                                │   │
│  │   Source → Extract → Parse → Chunk → Embed → Store                  │   │
│  │                                                                      │   │
│  │   ┌────────────┐  ┌──────────────┐  ┌───────────────┐              │   │
│  │   │ Extractor  │  │   Parser     │  │   Chunker     │              │   │
│  │   │ (PDF提取)   │  │ (Markdown    │  │ (Markdown感知  │              │   │
│  │   │            │  │  感知解析)    │  │  语义分块)     │              │   │
│  │   │ MinerU API │  │              │  │               │              │   │
│  │   │ PyMuPDF    │  │              │  │ max=800 token │              │   │
│  │   └────────────┘  └──────────────┘  └───────────────┘              │   │
│  │                                                                      │   │
│  │   ┌────────────┐  ┌──────────────┐  ┌───────────────┐              │   │
│  │   │ Embedding  │  │  Retriever   │  │   LLM Client  │              │   │
│  │   │ Client     │  │ (语义检索器)  │  │  (流式对话)    │              │   │
│  │   │            │  │              │  │               │              │   │
│  │   │ BAAI/bge-m3│  │ cosine sim.  │  │ SSE streaming │              │   │
│  │   │ OpenAI API │  │ top_k filter │  │ OpenAI Compat │              │   │
│  │   └────────────┘  └──────────────┘  └───────────────┘              │   │
│  │                                                                      │   │
│  │   ┌──────────────────────────┐                                      │   │
│  │   │   PromptRegistry         │                                      │   │
│  │   │   (Prompt 模板管理)       │                                      │   │
│  │   └──────────────────────────┘                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                       │                                                     │
│                       ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Storage Layer (数据存储层)                         │   │
│  │                                                                      │   │
│  │   ┌─────────────────────┐     ┌─────────────────────────┐          │   │
│  │   │  SQLite + SQLAlchemy │     │  ChromaDB (Persistent)  │          │   │
│  │   │                     │     │                         │          │   │
│  │   │  - items 表          │     │  - research collection  │          │   │
│  │   │    id, title,        │     │  - cosine similarity    │          │   │
│  │   │    authors, year,    │     │  - HNSW 索引            │          │   │
│  │   │    index_status,     │     │  - metadata filtering   │          │   │
│  │   │    embedding_model   │     │  - 本地持久化            │          │   │
│  │   │                     │     │                         │          │   │
│  │   │  结构化元数据存储     │     │  向量 + 文本 + 元数据    │          │   │
│  │   └─────────────────────┘     └─────────────────────────┘          │   │
│  │                                                                      │   │
│  │   存储路径: ./data/zoteroseek.db          ./data/chroma/            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流详解

#### 索引流程（Index Pipeline）

```
用户选择 PDF
    │
    ▼
POST /api/v1/index { pdf_path, item_id, extractor }
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ IngestionPipeline.ingest(ctx: PipelineContext)           │
│                                                         │
│  1. Extract  ── MinerUExtractor.extract(pdf_path)       │
│     │          POST → 上传 OSS → 轮询 → 下载 Markdown   │
│     ▼                                                   │
│  2. Parse    ── DocumentParser.parse(raw, item_id)      │
│     │          Markdown → CanonicalDocument (标题/作者/  │
│     │          章节结构化)                                │
│     ▼                                                   │
│  3. Chunk    ── SemanticChunker.chunk(document)         │
│     │          按 Section 层次化分块                      │
│     │          不切断表格/公式/代码块                     │
│     │          max_tokens=800, overlap=100              │
│     ▼                                                   │
│  4. Embed    ── EmbeddingClient.embed(texts)            │
│     │          BAAI/bge-m3 via SiliconFlow API          │
│     │          批量处理, batch_size=20                   │
│     ▼                                                   │
│  5. Store    ── ChromaVectorStore.upsert(...)           │
│                SQLite 保存元数据 (Item 表)               │
│                ChromaDB 保存向量 + 文本 + 元数据         │
└─────────────────────────────────────────────────────────┘
```

#### 对话流程（Chat with Agent）

```
用户输入: "Transformer 模型的注意力机制是如何工作的？"
    │
    ▼
POST /api/v1/chat { message }
    │
    ▼
LangGraph ReAct Agent:
    │
    ├── LLM 思考: "用户在问学术概念，我需要先搜索知识库"
    │
    ├── 调用工具: search_knowledge("Transformer 注意力机制")
    │       │
    │       ├── EmbeddingClient.embed_single(query)
    │       ├── ChromaVectorStore.query(vector, top_k=5)
    │       └── 返回 5 个最相关的文献片段
    │
    ├── LLM 基于检索结果生成回答
    │   (流式输出 token-by-token via SSE)
    │
    └── 发送引用来源 (sources)
    │
    ▼
SSE 流式返回前端:
    data: 注意力机制（Attention）的核心思想是...
    data: 通过计算 Query、Key、Value 三个矩阵...
    sources: [{"tool":"search_knowledge","output_preview":"..."}]
    data: [DONE]
```

---

## 3. 技术选型对比

### 3.1 后端框架：FastAPI vs Flask vs Django vs Tornado

| 维度 | FastAPI | Flask | Django | Tornado |
|------|---------|-------|--------|---------|
| **类型系统** | Pydantic 原生集成，自动校验 | 无内置，需 marshmallow | DRF Serializer，较重 | 无内置 |
| **异步支持** | 原生 async/await（Starlette） | 2.0+ 部分支持 | 3.1+ 部分支持 | 原生异步 |
| **自动文档** | Swagger/ReDoc 自动生成 | 需 flask-apispec | DRF 自动生成 | 无 |
| **性能** | 高（与 Node.js/Go 接近） | 中等 | 较低（ORM 开销） | 高 |
| **SSE/流式** | StreamingResponse 原生支持 | 需手动实现 | 需手动实现 | 原生支持 |
| **学习曲线** | 低（Python 类型提示） | 最低 | 中等（全栈概念多） | 中等 |
| **生态成熟度** | 快速增长 | 最成熟 | 最成熟（全栈） | 较小 |
| **适用场景** | API 服务、微服务 | 小型项目、原型 | 全栈 Web 应用 | 高并发长连接 |

**选择 FastAPI 的原因**：

1. **原生异步 + SSE 支持**：项目核心是流式对话（SSE），FastAPI 的 `StreamingResponse` 原生支持异步生成器，无需额外适配
2. **Pydantic 数据校验**：项目大量使用 Pydantic 模型（`PipelineContext`、`PipelineResult`、`ChunkMetadata`、`ChatRequest` 等），FastAPI 将其无缝集成到请求/响应校验中
3. **自动 API 文档**：开发阶段可直接通过 `/docs` 调试所有端点，无需额外工具
4. **轻量级**：项目不需要 Django 的 ORM/模板/管理后台等全栈能力，只需要纯 API 服务
5. **类型安全**：配合 Python 3.10+ 类型提示，实现编译期错误检查

### 3.2 向量数据库：ChromaDB vs FAISS vs Milvus vs Pinecone vs Qdrant

| 维度 | ChromaDB | FAISS | Milvus | Pinecone | Qdrant |
|------|----------|-------|--------|----------|--------|
| **部署方式** | 本地嵌入式/服务端 | 本地库（C++） | 独立服务/Docker | 纯云托管 | Docker/嵌入式 |
| **持久化** | PersistentClient 原生支持 | 需手动 save/load | 原生支持 | 云端自动 | 原生支持 |
| **元数据过滤** | where 条件原生支持 | 不支持 | 原生支持 | 原生支持 | 原生支持 |
| **Python API** | 极简，pip install 即用 | 需编译/conda | 需 Docker | REST API | 较简洁 |
| **全文检索** | 无 | 无 | 支持 | 支持 | 支持 |
| **性能（<100K 向量）** | 够用 | 最快 | 过重 | 延迟高（网络） | 快 |
| **开源** | Apache 2.0 | MIT | Apache 2.0 | 闭源 | Apache 2.0 |
| **学习曲线** | 最低 | 中等 | 高 | 低 | 中等 |
| **适用规模** | 小型到中型 | 中型到大型 | 大型生产 | 任意（付费） | 中型到大型 |
| **嵌入式运行** | 支持（无需服务） | 支持 | 不支持 | 不支持 | 支持 |

**选择 ChromaDB 的原因**：

1. **本地嵌入式运行**：`PersistentClient` 一个函数调用即可启动，无需 Docker 或独立服务，符合"本地优先"理念
2. **元数据过滤**：支持 `where={"item_id": "xxx"}` 按文献 ID 过滤检索结果，这在多文献管理场景下是核心需求
3. **极简 API**：`collection.upsert()` 和 `collection.query()` 两个方法完成所有操作，学习和维护成本极低
4. **隐私保护**：`anonymized_telemetry=False` 一行配置禁用所有遥测，数据完全不离开本地
5. **数据持久化**：向量数据直接保存到 `./data/chroma/` 目录，应用重启后数据不丢失

**不选择 FAISS 的原因**：FAISS 是纯向量索引库，不支持元数据存储和过滤。项目需要按 `item_id`、`section_type` 等维度过滤结果，FAISS 无法满足。

**不选择 Milvus 的原因**：Milvus 需要独立部署 Docker 服务，对个人研究工具来说过重，增加安装和运维门槛。

### 3.3 PDF 解析：MinerU vs PyMuPDF vs pdfplumber vs GROBID vs Marker

| 维度 | MinerU (Agent API) | PyMuPDF | pdfplumber | GROBID | Marker |
|------|-------------------|---------|------------|--------|--------|
| **版面分析** | 深度学习模型，识别标题/表格/公式 | 无，纯文本提取 | 基于规则的表格检测 | ML 模型，学术论文特化 | ML 模型 |
| **输出格式** | 结构化 Markdown | 纯文本/HTML | 纯文本/表格数据 | TEI XML | Markdown |
| **表格处理** | 保留行列结构 | 丢失结构 | 较好，保留行列 | 较好 | 一般 |
| **公式识别** | LaTeX 输出 | 不支持 | 不支持 | LaTeX 输出 | LaTeX 输出 |
| **标题层级** | 自动识别 H1/H2/H3 | 不支持 | 不支持 | 自动识别 | 自动识别 |
| **部署方式** | 云 API（免 Token） | pip install | pip install | Docker 服务 | pip install（需 GPU） |
| **速度** | 中等（网络 + 排队） | 最快 | 快 | 慢 | 中等 |
| **限制** | 10MB、20 页 | 无 | 无 | 需部署 | 需 GPU |
| **适合场景** | 学术论文（首选） | 快速提取/大文件 | 表格密集型文档 | 学术论文（备选） | 通用文档 |

**选择 MinerU + PyMuPDF 双引擎的原因**：

1. **MinerU 作为主引擎**：深度学习版面分析能准确识别学术论文的标题层级、表格、公式，生成的结构化 Markdown 直接喂给下游的 Markdown 感知分块器，形成完整的结构保留链路
2. **PyMuPDF 作为备选**：当 MinerU API 不可用、文件超过 10MB、或需要快速提取时，PyMuPDF 作为轻量级本地方案兜底
3. **策略模式设计**：`Extractor` 抽象基类 + `MinerUExtractor`/`PDFExtractor` 实现类，通过 API 参数 `extractor: "mineru"/"pymupdf"` 动态切换
4. **MinerU Agent API 免费**：免 Token 认证（IP 限频），无需 GPU 部署，通过 httpx 异步调用即可

**不选择 GROBID 的原因**：需要独立部署 Docker 服务，对个人工具来说运维成本过高。MinerU 在学术论文场景下能力相当且零部署成本。

### 3.4 Agent 框架：LangChain + LangGraph vs AutoGen vs CrewAI vs 自研

| 维度 | LangChain + LangGraph | AutoGen (微软) | CrewAI | 手写 Agent |
|------|----------------------|----------------|--------|-----------|
| **Agent 模式** | ReAct / 自定义图 | 多 Agent 对话 | 角色分工协作 | 完全自定义 |
| **工具调用** | @tool 装饰器，极简 | 函数定义 + 注册 | 类似 LangChain | 手动实现 |
| **流式支持** | astream_events 原生支持 | 较弱 | 较弱 | 需自行实现 |
| **状态管理** | LangGraph 图状态机 | 对话历史 | 任务队列 | 手动管理 |
| **调试工具** | LangSmith（可选） | 内置日志 | 有限 | 无 |
| **学习曲线** | 中等 | 高 | 中等 | 取决于复杂度 |
| **依赖体积** | 中等 | 较大 | 较大 | 无额外依赖 |
| **灵活性** | 高（图可自定义） | 中等 | 低（角色固定） | 最高 |
| **社区活跃度** | 最高 | 高 | 中等 | N/A |

**选择 LangChain + LangGraph 的原因**：

1. **ReAct Agent 开箱即用**：`create_react_agent(llm, tools, prompt)` 一行代码创建完整的 ReAct 循环，LLM 自主决定是否调用工具、调用哪个工具、是否需要多次调用
2. **工具定义极简**：用 `@tool` 装饰器 + docstring 即可定义工具，参数类型和描述自动从函数签名和文档字符串提取
3. **流式事件系统**：`astream_events(version="v2")` 提供精细的事件流（`on_chat_model_stream`、`on_tool_end` 等），完美匹配 SSE 场景
4. **从普通 RAG 到 Agent 的升级路径**：项目经历了从手写 RAG（固定流程：检索 → 生成）到 LangGraph Agent（LLM 自主决策）的架构升级，LangGraph 使得这个迁移过程平滑且代码量最小

**不选择 AutoGen 的原因**：AutoGen 的多 Agent 对话模式对单用户研究助手来说过重，且流式支持不如 LangGraph 完善。

### 3.5 前端状态管理：Zustand vs Redux vs Context API vs Jotai vs Recoil

| 维度 | Zustand | Redux Toolkit | Context API | Jotai | Recoil |
|------|---------|---------------|-------------|-------|--------|
| **API 复杂度** | 极简（一个 create 函数） | 中等（slice/reducer/action） | 低 | 低 | 中等 |
| **样板代码** | 几乎没有 | 较多 | 少 | 少 | 中等 |
| **TypeScript** | 优秀，自动推导 | 需手动定义 | 原生支持 | 优秀 | 一般 |
| **性能** | 精确订阅，无冗余渲染 | 中等（需 selector） | Context 变化全量渲染 | 原子化，最优 | 原子化 |
| **持久化** | middleware 支持 | 需 redux-persist | 不支持 | 不支持 | 不支持 |
| **DevTools** | 支持 | Redux DevTools（最强） | 无 | 支持 | 支持 |
| **Bundle 大小** | ~1KB | ~11KB (RTK) | 0（内置） | ~3KB | ~12KB |
| **学习曲线** | 最低 | 中等 | 最低 | 低 | 中等 |

**选择 Zustand 的原因**：

1. **极简 API**：`create((set) => ({ count: 0, inc: () => set(s => ({count: s.count+1})) }))` 一行定义 store，无需 action/reducer/Provider 样板代码
2. **精确订阅**：组件只在使用的状态片段变化时重新渲染，避免 Context API 的"一个值变化，所有消费者重渲染"问题
3. **中间件生态**：`persist` 中间件一行代码实现状态持久化（项目中 chatStore 使用 Dexie/IndexedDB 持久化对话历史）
4. **Bundle 极小**：约 1KB gzip，对插件打包体积友好
5. **Zotero 沙盒兼容**：在 Zotero 9 的受限环境中，Zustand 的无 Provider 设计避免了 React Context 在非标准 DOM 环境下的潜在问题

### 3.6 CSS 方案：Tailwind CSS vs CSS Modules vs styled-components vs Vanilla Extract

| 维度 | Tailwind CSS | CSS Modules | styled-components | Vanilla Extract |
|------|-------------|-------------|-------------------|-----------------|
| **开发速度** | 最快（直接写类名） | 中等 | 中等 | 较慢 |
| **Bundle 大小** | 极小（PurgeCSS） | 小 | 大（运行时） | 极小（零运行时） |
| **类型安全** | 无（纯字符串） | 无 | 有限 | 完整（TS 原生） |
| **暗色模式** | `dark:` 前缀，极简 | 手动管理类名 | 手动实现 | 手动实现 |
| **响应式** | `sm:`/`md:`/`lg:` 前缀 | 手写 media query | 手写 media query | 手写 media query |
| **可维护性** | HTML 较长但一致 | 文件分离清晰 | 组件内聚 | 文件分离 |
| **设计系统** | 内置（colors/spacing） | 需手动定义 | 需 ThemeProvider | 需手动定义 |
| **学习曲线** | 低（记类名） | 低 | 中等 | 高 |
| **Zotero 插件兼容** | 好（纯 CSS 输出） | 好 | 差（需运行时） | 好 |

**选择 Tailwind CSS 的原因**：

1. **暗色模式一行代码**：`darkMode: 'class'` + `dark:bg-gray-900` 类名前缀，配合项目的 ThemeProvider DOM 注入（`document.documentElement.classList.toggle('dark')`），9 个组件的深浅色适配成本极低
2. **自定义设计系统**：通过 `tailwind.config.js` 的 `theme.extend.colors` 定义品牌色（`zs-bg-primary: '#111113'`、`zs-accent: '#5B7FFF'`），全局一致
3. **PurgeCSS 零冗余**：构建时自动移除未使用的类名，最终 CSS 体积极小
4. **禁用 Preflight**：`corePlugins: { preflight: false }` 避免 Tailwind 的基础样式重置与 Zotero 原生 UI 冲突
5. **与 React 组件化完美配合**：类名直接写在 JSX 中，无需在 CSS 文件和组件文件之间来回跳转

### 3.7 Embedding 模型：BAAI/bge-m3 vs text-embedding-3-small vs text-embedding-3-large vs E5-Mistral vs GTE-Qwen2

| 维度 | BAAI/bge-m3 | text-embedding-3-small | text-embedding-3-large | E5-Mistral-7B | GTE-Qwen2-7B |
|------|------------|----------------------|----------------------|---------------|---------------|
| **维度** | 1024 | 1536 | 3072 | 4096 | 3584 |
| **多语言** | 优秀（100+ 语言） | 良好 | 良好 | 良好 | 优秀 |
| **中文能力** | 最优（专门优化） | 一般 | 良好 | 一般 | 优秀 |
| **最大 token** | 8192 | 8191 | 8191 | 32768 | 32768 |
| **部署方式** | API (SiliconFlow) / 本地 | OpenAI API | OpenAI API | 需 GPU 本地 | 需 GPU 本地 |
| **API 价格** | 极低（SiliconFlow） | $0.02/1M tokens | $0.13/1M tokens | 无 API | 无 API |
| **MTEB 排名** | Top 10 | Top 20 | Top 10 | Top 5 | Top 5 |
| **速度** | 快 | 快 | 中等 | 慢（7B 模型） | 慢（7B 模型） |
| **稀疏检索** | 支持（混合检索） | 不支持 | 不支持 | 不支持 | 不支持 |

**选择 BAAI/bge-m3 的原因**：

1. **中文学术场景最优**：项目面向中文用户为主，bge-m3 在中文文本嵌入的语义理解上显著优于 OpenAI 系列
2. **多语言 + 混合检索**：支持密集检索（dense）、稀疏检索（sparse）、多向量检索（multi-vector），为未来升级到混合检索留有空间
3. **高性价比**：通过 SiliconFlow API 调用，价格远低于 OpenAI，且国内网络访问稳定
4. **1024 维度平衡**：在向量质量和存储/计算成本之间取得平衡（text-embedding-3-small 是 1536 维，存储更大但质量不一定更好）

---

## 4. 三大组件职责

### 4.1 Zotero Plugin（极薄桥接层）

**定位**：仅作为 Zotero 和后端之间的"桥梁"，不承载任何业务逻辑。

**技术栈**：
- TypeScript + zotero-plugin-scaffold（构建工具链）
- bootstrap.js（Zotero 插件生命周期入口）
- zotero-plugin-toolkit（Zotero API 封装）

**核心文件与职责**：

| 文件 | 职责 |
|------|------|
| `bootstrap.js` | Zotero 插件生命周期钩子（onStartup / onShutdown / install / uninstall） |
| `src/launcher.ts` | 启动后端进程 + 打开浏览器 UI（`Zotero.launchURL()`） |
| `src/bridge.ts` | HTTP 客户端封装（health / index / search / library / chat），通过 `fetch` 调用后端 API |
| `src/utils/prefs.ts` | Zotero 偏好设置读写（`Zotero.Prefs`），提供 API Key、URL、端口等配置 |
| `manifest.json` | 插件元数据（addonID、版本、strict_max_version） |

**关键约束**（Zotero 9 沙盒环境）：
- 不能使用 `console`（用 `Zotero.log()`）
- 不能使用 `localStorage`（用 `Zotero.Prefs`）
- `IndexedDB` 不可用（chatStore 自动 fallback 到内存 Map）
- `setTimeout`/`navigator` 等浏览器 API 需要 polyfill
- manifest.json 必须包含 `strict_max_version: "9.*"`

### 4.2 Python Backend（核心 Runtime）

**定位**：整个系统的大脑，承载所有 AI/数据处理逻辑。

**技术栈**：
- FastAPI + Uvicorn（HTTP 服务）
- LangChain + LangGraph（Agent 框架）
- SQLAlchemy + SQLite（关系数据存储）
- ChromaDB（向量数据存储）
- Pydantic + pydantic-settings（数据校验 + 配置管理）
- httpx（异步 HTTP 客户端，调用 Embedding/MinerU API）
- loguru（结构化日志）

**分层架构**：

```
backend/
├── api/                     # API 路由层 - HTTP 请求处理
│   ├── chat.py              # POST /chat → LangGraph Agent → SSE 流式响应
│   ├── index.py             # POST /index → IngestionPipeline
│   ├── search.py            # POST /search → Retriever
│   ├── library.py           # GET /library → SQLite 查询
│   ├── zotero.py            # GET /zotero-items → Zotero Web API 代理
│   ├── health.py            # GET /health → 服务健康检查
│   └── shared_deps.py       # 共享依赖注入（embedder, vector_store, parser 等）
│
├── agent/                   # Agent 层 - LangGraph ReAct Agent
│   ├── graph.py             # create_react_agent 定义 + 系统提示词
│   └── tools.py             # @tool 装饰器定义（search_knowledge, query_library, index_document）
│
├── core/                    # 核心处理层
│   ├── pipeline/            # 文档摄入流水线
│   │   ├── interfaces.py    # PipelineContext, PipelineResult（Pydantic 模型）
│   │   ├── ingestion.py     # IngestionPipeline（编排 Extract→Parse→Chunk→Embed→Store）
│   │   ├── parser.py        # DocumentParser（Markdown → CanonicalDocument）
│   │   └── chunker.py       # SemanticChunker（Markdown 感知语义分块）
│   ├── rag/                 # RAG 检索
│   │   ├── retriever.py     # Retriever（向量检索 + 元数据过滤）
│   │   └── chat_integration.py  # RAG 与对话的集成逻辑
│   ├── llm/                 # LLM 客户端
│   │   ├── client.py        # LLMClient（流式对话）
│   │   └── embeddings.py    # EmbeddingClient（OpenAI Compatible API）
│   └── prompts/             # Prompt 管理
│       └── registry.py      # PromptRegistry（模板化 Prompt 管理）
│
├── data/                    # 数据存储层
│   ├── db.py                # SQLAlchemy engine + session（SQLite）
│   ├── models.py            # ORM 模型（Item 表：id, title, authors, index_status...）
│   ├── vector_store.py      # VectorStore 抽象基类（ABC + Pydantic）
│   └── chroma_store.py      # ChromaVectorStore 实现（适配器模式）
│
├── extractors/              # 文档提取器
│   ├── base.py              # Extractor 抽象基类 + RawContent 模型
│   ├── pdf.py               # PDFExtractor（PyMuPDF，快速提取）
│   └── mineru_extractor.py  # MinerUExtractor（MinerU Agent API，深度学习版面分析）
│
├── models/                  # Pydantic 数据模型
│   ├── document.py          # CanonicalDocument, DocumentSection, SectionType
│   └── chunk.py             # Chunk, ChunkMetadata
│
├── config/                  # 配置管理
│   └── settings.py          # Pydantic Settings（从 .env 加载，ZOTEROSEEK_ 前缀）
│
├── static/                  # React 前端构建输出（由 FastAPI StaticFiles 挂载）
└── main.py                  # FastAPI 应用入口（路由注册 + CORS + 生命周期管理）
```

### 4.3 React Frontend（独立 UI）

**定位**：面向用户的交互界面，通过 HTTP/SSE 与后端通信。

**技术栈**：
- React 18 + TypeScript（UI 框架）
- Tailwind CSS（样式系统）
- Zustand（状态管理）
- Vite + esbuild（构建工具）
- react-markdown + react-syntax-highlighter（Markdown 渲染）
- axios（HTTP 客户端，普通请求）
- 原生 fetch + ReadableStream（SSE 流式请求）

**目录结构与职责**：

```
frontend/src/
├── App.tsx                  # 应用根组件
├── main.tsx                 # 入口文件
├── api/
│   └── client.ts            # 统一 API 客户端（axios + fetch 双引擎策略）
│                             # - 普通请求用 axios（拦截器/自动JSON）
│                             # - 流式请求用 fetch ReadableStream（SSE）
├── views/
│   ├── Chat.tsx             # 对话视图（消息列表 + 输入框 + 流式渲染）
│   ├── Library.tsx          # 文献库视图（已索引文献列表 + 索引操作）
│   └── Search.tsx           # 搜索视图（语义搜索 + 结果展示）
├── stores/
│   ├── chatStore.ts         # 对话状态（消息列表、当前会话、流式状态）
│   ├── sessionStore.ts      # 会话管理（多会话列表、切换、创建、删除）
│   └── themeStore.ts        # 主题状态（深色/浅色模式切换）
├── components/
│   └── SessionSidebar.tsx   # 会话侧边栏组件
└── index.css                # 全局样式 + Tailwind 引入
```

**API 通信协议**：

| 接口 | 方法 | 协议 | 用途 |
|------|------|------|------|
| `/api/v1/health` | GET | JSON | 健康检查 |
| `/api/v1/chat` | POST | SSE | Agent 流式对话 |
| `/api/v1/index` | POST | JSON | 索引 PDF |
| `/api/v1/search` | POST | JSON | 语义搜索 |
| `/api/v1/library` | GET | JSON | 已索引文献列表 |
| `/api/v1/zotero-items` | GET | JSON | Zotero 文献库条目 |
| `/api/v1/index-zotero` | POST | JSON | 批量索引 Zotero 文献 |

---

## 5. 关键设计决策

### 5.1 为什么采用分离架构（而非全部在插件中实现）

**背景**：Zotero 插件开发有两个主流方案：

| 方案 | 代表项目 | 架构 |
|------|----------|------|
| 方案 A：单体插件 | Zotero-GPT | 所有逻辑（LLM 调用、RAG、UI）都在插件内 |
| 方案 B：分离架构 | ZoteroSeek | 插件极薄 + 独立 Python Backend + 独立 React UI |

**选择方案 B（分离架构）的 5 个核心原因**：

1. **Zotero 沙盒环境严重受限**：
   - 无 `console`、无 `localStorage`、无 `IndexedDB`
   - `setTimeout`/`navigator`/`structuredClone` 等浏览器 API 需要 polyfill
   - React + Zustand + Dexie 在沙盒中会阻塞主线程导致 Zotero 卡死（项目早期实测）
   - Python 生态（ChromaDB、LangChain、SQLAlchemy）根本无法在 JS 沙盒中运行

2. **Python 生态不可替代**：
   - RAG 系统的最佳工具链（LangChain/LangGraph、ChromaDB、PyMuPDF、MinerU）全部在 Python 生态
   - 如果在 JS 中实现等价功能，需要重写大量库且质量远不如原版

3. **独立可测试**：
   - Backend 可以独立启动和测试（`uv run python -m backend.main`），不依赖 Zotero
   - Frontend 可以独立开发（`npm run dev`，Vite 热重载），不依赖 Zotero
   - 三端解耦后，开发效率大幅提升

4. **用户体验更好**：
   - 浏览器 UI 比嵌入 Zotero 面板有更大的渲染空间和更好的交互体验
   - 支持独立窗口、全屏模式，不受 Zotero 面板尺寸限制

5. **渐进式架构演进**：
   - 未来可以将 Backend 部署为远程服务（多人协作场景）
   - Frontend 可以独立演进为 PWA 或桌面应用
   - Plugin 可以替换为其他入口（如 VS Code 插件、CLI 工具）

### 5.2 为什么选择 RAG（而非微调/全量上下文）

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **RAG（项目选择）** | 实时更新、可溯源、无需训练 | 依赖检索质量 | 知识频繁更新、需要引用 |
| 微调（Fine-tuning） | 回答风格可控、无需检索 | 训练成本高、知识会过时 | 特定领域风格定制 |
| 全量上下文 | 实现最简单 | token 成本爆炸、有窗口限制 | 文档量极少（<3 篇） |

**选择 RAG 的原因**：

1. **文献库持续增长**：用户会不断添加新论文，RAG 无需重新训练即可检索新内容
2. **引用溯源需求**：学术场景必须标明答案来自哪篇论文的哪个章节，RAG 天然提供溯源能力
3. **成本可控**：每次对话只检索 top_k 个片段（约 4000 token），而非将整个文献库塞入上下文
4. **隐私保护**：用户的文献数据不上传到任何训练平台

### 5.3 为什么选择 SSE（而非 WebSocket）

| 维度 | SSE（项目选择） | WebSocket | 轮询（Polling） |
|------|----------------|-----------|----------------|
| **方向** | 服务端 → 客户端（单向） | 双向 | 客户端 → 服务端（单向） |
| **协议** | HTTP/1.1 或 HTTP/2 | 独立的 ws:// 协议 | HTTP |
| **自动重连** | 浏览器原生支持 | 需手动实现 | 不适用 |
| **实现复杂度** | 最低（StreamingResponse） | 中等（需连接管理） | 最低 |
| **Nginx/代理兼容** | 好（标准 HTTP） | 需特殊配置 | 好 |
| **连接开销** | 低（复用 HTTP） | 中等（独立连接） | 高（每次新建） |

**选择 SSE 的原因**：

1. **场景完美匹配**：对话场景是典型的"服务端单向推送"——用户发送一条消息，服务端流式返回 token。不需要客户端向服务端持续发送数据，WebSocket 的双向能力是浪费
2. **FastAPI 原生支持**：`StreamingResponse(generate(), media_type="text/event-stream")` 一行代码实现
3. **前端实现简单**：原生 `fetch` + `ReadableStream` + `TextDecoder` 即可解析，无需引入 socket.io 等库
4. **连接管理简单**：SSE 基于标准 HTTP，天然兼容 CORS、Nginx 反向代理、CDN 等基础设施

### 5.4 为什么选择 ChromaDB（而非 FAISS）

| 维度 | ChromaDB（项目选择） | FAISS |
|------|---------------------|-------|
| **元数据过滤** | `where={"item_id": "xxx"}` 原生支持 | 不支持，需自行实现 |
| **持久化** | `PersistentClient(path=...)` 一行代码 | 需手动 `faiss.write_index()` |
| **数据模型** | 向量 + 文本 + 元数据一体化存储 | 纯向量，文本和元数据需另存 |
| **安装难度** | `pip install chromadb` | 需 conda 或编译安装 |
| **API 设计** | `collection.upsert()/query()` | 需理解 Index 类型体系 |

**选择 ChromaDB 的核心原因**：

项目需要按 `item_id`（文献 ID）和 `section_type`（章节类型）过滤检索结果。例如用户问"这篇论文的 Methodology 部分讲了什么"，系统需要先按 `item_id` 和 `section_type` 过滤再做向量检索。FAISS 是纯向量索引库，不支持这种元数据过滤。

### 5.5 为什么使用 Markdown 感知分块（而非固定字数切分）

```
固定字数切分（500 字一刀切）：

  |... 文本 ... 文本 ... 文本 ...|    ← 表格被从中间切断
  |... 表格 | 表格 ... 文本 ...|      ← 表格结构丢失
  |... $$ 公式未闭合 ... 文本|         ← LaTeX 公式损坏

Markdown 感知分块（SemanticChunker）：

  |... 文本 ... 文本 ...|             ← 在段落边界断开
  |... 完整表格 ||||| ...|             ← 表格保持完整
  |... $$ 完整公式 $$ ...|            ← 公式保持完整
  |... ``` 完整代码块 ``` ...|         ← 代码块保持完整
```

**核心改进**：
- 使用状态机（`in_math`、`in_code` 标志）追踪当前是否在公式/代码块内部
- 连续的表格行（`|` 开头）自动合并为一个整体
- 基于 Section 的层次化分块，每个 Chunk 都有明确的章节归属
- Overlap 策略按段落边界重叠，保证上下文连续性

---

## 6. 环境配置

### 6.1 环境要求

| 组件 | 最低版本 | 用途 |
|------|----------|------|
| Python | 3.10+ | Backend 运行时 |
| Node.js | 18+ | Frontend + Plugin 构建 |
| Zotero | 9.0+ | 插件宿主 |
| uv | 最新版 | Python 环境管理（替代 pip/venv） |

### 6.2 环境变量（.env 文件）

项目根目录 `.env` 完整配置：

```bash
# ==================== LLM 配置 ====================
# 对话使用的 LLM 模型（兼容 OpenAI 接口的任何模型）
ZOTEROSEEK_LLM_API_KEY=your-api-key-here
ZOTEROSEEK_LLM_BASE_URL=https://api.openai.com/v1    # 或 DeepSeek/MiMo/SiliconFlow 等
ZOTEROSEEK_LLM_MODEL=gpt-4o-mini                      # 或 deepseek-chat, mimo-v2.5 等

# ==================== Embedding 配置 ====================
# 文本向量化模型（将文本转换为向量表示）
ZOTEROSEEK_EMBEDDING_API_KEY=your-api-key-here
ZOTEROSEEK_EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1  # SiliconFlow（推荐，国内快）
ZOTEROSEEK_EMBEDDING_MODEL=BAAI/bge-m3                        # 多语言嵌入模型

# ==================== 服务器配置 ====================
ZOTEROSEEK_HOST=127.0.0.1          # 后端监听地址
ZOTEROSEEK_PORT=20801              # 后端监听端口
ZOTEROSEEK_DEBUG=true              # 开发模式（热重载）

# ==================== Zotero 集成 ====================
ZOTEROSEEK_ZOTERO_API_URL=http://localhost:23119/api   # Zotero Web API 地址
ZOTEROSEEK_ZOTERO_API_KEY=                              # Zotero API Key（可选）
ZOTEROSEEK_ZOTERO_STORAGE_PATH=D:/WorkSpace/ZoteroData/storage  # Zotero PDF 存储路径

# ==================== 数据库配置 ====================
ZOTEROSEEK_SQLITE_PATH=./data/zoteroseek.db             # SQLite 数据库路径
ZOTEROSEEK_CHROMA_PATH=./data/chroma                     # ChromaDB 向量数据路径

# ==================== MinerU PDF 解析 ====================
# 留空 = 自动使用 MinerU 免费云 API（mineru.net）
# 填写 URL = 连接自建 MinerU 服务
ZOTEROSEEK_MINERU_API_URL=
ZOTEROSEEK_MINERU_API_KEY=
ZOTEROSEEK_MINERU_BACKEND=pipeline
ZOTEROSEEK_MINERU_PARSE_METHOD=auto
ZOTEROSEEK_MINERU_LANGUAGE=ch                            # 文档语言（ch=中文, en=英文）
```

### 6.3 环境变量到代码的映射

配置通过 `pydantic-settings` 自动加载，映射规则：

```
环境变量名                    →   settings 属性名
ZOTEROSEEK_LLM_API_KEY       →   settings.llm_api_key
ZOTEROSEEK_LLM_BASE_URL      →   settings.llm_base_url
ZOTEROSEEK_PORT              →   settings.port
ZOTEROSEEK_CHROMA_PATH       →   settings.chroma_path
```

映射规则：`ZOTEROSEEK_` 前缀 + 属性名（小写下划线），定义在 `backend/config/settings.py` 的 `Settings` 类中。

### 6.4 uv 环境管理

**为什么用 uv 而非 pip/venv？**

| 维度 | uv | pip + venv | conda |
|------|-----|-----------|-------|
| 安装速度 | 极快（Rust 实现） | 慢 | 中等 |
| 依赖解析 | 快且确定性 | 慢且不确定 | 中等 |
| 锁文件 | uv.lock | 需 pip-tools | conda-lock |
| Python 版本管理 | 内置 | 需 pyenv | 内置 |
| 磁盘占用 | 极小 | 中等 | 大 |

**常用命令**：

```bash
# 安装依赖（首次 + 每次 pyproject.toml 变更后）
cd backend && uv sync

# 启动后端（从项目根目录执行）
uv run python -m backend.main

# 添加新依赖
uv add package-name

# 验证导入
uv run python -c "from backend.main import app; print('OK')"
```

### 6.5 开发工作流

```bash
# ==================== 1. 启动后端 ====================
# 终端 1（从项目根目录执行）
uv run python -m backend.main
# 预期输出: INFO: Uvicorn running on http://0.0.0.0:20801

# ==================== 2. 启动前端 ====================
# 终端 2
cd frontend
npm install
npm run dev
# 预期输出: VITE v5.x.x ready

# ==================== 3. 验证服务 ====================
# 浏览器访问前端: http://localhost:5173（Vite 热重载开发）
# 浏览器访问后端: http://localhost:20801（FastAPI 静态文件服务 + API 文档）
# API 文档: http://localhost:20801/docs（Swagger UI）

# ==================== 4. 构建插件（可选） ====================
# 终端 3
npm run build
# 输出: .scaffold/build/zoteroseek.xpi

# ==================== 5. 安装到 Zotero ====================
# Zotero → 工具 → 附加组件 → 齿轮图标 → 从文件安装 → 选择 .xpi
```

### 6.6 Pydantic Settings 加载机制

```python
# backend/config/settings.py

from pydantic_settings import BaseSettings
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.parent  # 项目根目录

class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 20801
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    # ... 更多字段

    model_config = {
        "env_prefix": "ZOTEROSEEK_",           # 环境变量前缀
        "env_file": str(ROOT_DIR / ".env"),      # 从项目根目录加载 .env
        "env_file_encoding": "utf-8",
    }

settings = Settings()  # 全局单例，模块导入时自动加载
```

**加载优先级**（从高到低）：
1. 系统环境变量（`export ZOTEROSEEK_PORT=8080`）
2. `.env` 文件（项目根目录）
3. 代码中的默认值（`port: int = 20801`）

---

## 附录：项目文件结构总览

```
ZoteroSeek/
├── .env                              # 环境变量配置
├── AGENTS.md                         # AI Agent 项目知识库
├── PROJECT_REQUIREMENTS.md           # 项目需求文档
├── README.md / README_zh-CN.md       # 中英文 README
├── package.json                      # Node.js 依赖 + 构建脚本
├── tsconfig.json                     # TypeScript 配置
├── tailwind.config.js                # Tailwind CSS 配置
├── vitest.config.ts                  # 测试框架配置
├── zotero-plugin.config.ts           # Zotero 插件构建配置
│
├── backend/                          # Python Backend（核心 runtime）
│   ├── main.py                       # FastAPI 入口
│   ├── pyproject.toml                # Python 依赖声明（uv 管理）
│   ├── uv.lock                       # 依赖锁文件
│   ├── api/                          # API 路由（6 个端点）
│   ├── agent/                        # LangGraph ReAct Agent
│   ├── core/                         # 核心处理（pipeline + rag + llm + prompts）
│   ├── data/                         # 数据存储（SQLite + ChromaDB）
│   ├── extractors/                   # PDF 提取器（MinerU + PyMuPDF）
│   ├── models/                       # Pydantic 数据模型
│   ├── config/                       # 配置管理（pydantic-settings）
│   └── static/                       # React 构建输出
│
├── frontend/                         # React Frontend（独立 UI）
│   ├── src/
│   │   ├── api/client.ts             # 统一 API 客户端
│   │   ├── views/                    # 视图（Chat, Library, Search）
│   │   ├── stores/                   # Zustand 状态管理
│   │   └── components/               # UI 组件
│   └── package.json
│
├── plugin/                           # Zotero 插件（极薄桥接层）
│   ├── manifest.json                 # 插件元数据
│   ├── bootstrap.js                  # 生命周期入口
│   ├── src/
│   │   ├── launcher.ts               # 启动后端 + 打开浏览器
│   │   └── bridge.ts                 # HTTP 客户端
│   └── chrome/                       # 资源文件（图标、locale、xhtml）
│
├── docs/                             # 项目文档
│   └── modules/                      # 模块化文档
│       └── 01-project-overview.md    # 本文档
│
└── data/                             # 运行时数据
    ├── zoteroseek.db                 # SQLite 数据库
    └── chroma/                       # ChromaDB 向量数据
```
