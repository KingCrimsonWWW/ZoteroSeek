# ZoteroSeek 项目深度教学指南

> 本文档是 ZoteroSeek 项目的完整技术教学文档，帮助你深入理解每一层架构、每一行关键代码的设计意图。
> 适合作为简历准备材料 —— 面试时你能清晰解释每个技术决策。

---

## 目录

1. [项目全景](#1-项目全景)
2. [技术选型与对比](#2-技术选型与对比)
3. [后端架构详解](#3-后端架构详解)
4. [RAG Pipeline 详解](#4-rag-pipeline-详解)
5. [前端架构详解](#5-前端架构详解)
6. [Zotero 插件架构](#6-zotero-插件架构)
7. [数据流全链路](#7-数据流全链路)
8. [设计模式与工程实践](#8-设计模式与工程实践)
9. [已知问题与改进方向](#9-已知问题与改进方向)
10. [面试常见问题](#10-面试常见问题)

---

## 1. 项目全景

### 1.1 一句话描述

ZoteroSeek 是一个**本地部署的 AI 研究助手**，以 Zotero 文献库为数据源，通过 RAG（检索增强生成）技术实现学术论文的语义搜索和智能问答。

### 1.2 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│  用户界面层                                                       │
│  ┌──────────────┐    ┌──────────────────┐                       │
│  │ Zotero 插件   │    │ React Web UI     │                       │
│  │ (极薄桥接层)  │    │ (Vite + Tailwind)│                       │
│  └──────┬───────┘    └────────┬─────────┘                       │
│         │ HTTP                │ HTTP (SSE)                       │
└─────────┼─────────────────────┼──────────────────────────────────┘
          │                     │
          ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Python Backend (FastAPI + Uvicorn)                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  API Layer                                                │    │
│  │  /health  /index  /search  /chat  /library  /zotero-*    │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Core Layer                                               │    │
│  │  ┌──────────┐  ┌──────┐  ┌───────┐  ┌──────────────┐   │    │
│  │  │ Pipeline  │  │ RAG  │  │ LLM   │  │ PromptRegistry│   │    │
│  │  │ Extract → │  │      │  │Client │  │              │   │    │
│  │  │ Parse  →  │  │      │  │       │  │              │   │    │
│  │  │ Chunk  →  │  │      │  │       │  │              │   │    │
│  │  │ Embed  →  │  │      │  │       │  │              │   │    │
│  │  │ Store     │  │      │  │       │  │              │   │    │
│  │  └──────────┘  └──────┘  └───────┘  └──────────────┘   │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Storage Layer                                            │    │
│  │  ┌──────────────┐  ┌──────────────┐                      │    │
│  │  │ SQLite        │  │ ChromaDB     │                      │    │
│  │  │ (元数据)      │  │ (向量存储)    │                      │    │
│  │  └──────────────┘  └──────────────┘                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 三大组件的职责划分

| 组件 | 职责 | 技术栈 | 代码量 |
|------|------|--------|--------|
| **Python Backend** | 核心 runtime：PDF 解析、向量化、RAG、LLM 调用 | FastAPI + ChromaDB + SQLite | ~1500 行 |
| **React Frontend** | 用户界面：Chat、Library、Search | React 18 + Zustand + Tailwind | ~1200 行 |
| **Zotero Plugin** | 极薄桥接层：启动后端、打开浏览器、存储配置 | TypeScript + zotero-plugin-scaffold | ~400 行 |

**设计决策：为什么分离？**

> **替代方案**：全部塞进 Zotero 插件（像 Zotero-GPT 那样）
>
> **为什么不用**：Zotero 插件运行在 Firefox 115 沙盒中，限制极多（无 `console`、无 `localStorage`、无 `IndexedDB`、React 会阻塞主线程导致 Zotero 卡死）。我们把重活交给 Python 后端，插件只做 HTTP 调用，避免所有沙盒问题。

---

## 2. 技术选型与对比

### 2.1 后端框架：FastAPI vs Flask vs Django

| 维度 | FastAPI ✅ | Flask | Django |
|------|-----------|-------|--------|
| 异步支持 | 原生 `async/await` | 需要扩展 | 3.1+ 支持 |
| 类型校验 | Pydantic 自动校验 | 手动 | DRF Serializer |
| API 文档 | 自动生成 OpenAPI | 需要扩展 | DRF 自带 |
| 性能 | 接近 Node.js | 一般 | 一般 |
| 学习曲线 | 低 | 低 | 高 |

**选择 FastAPI 的原因**：我们需要 SSE 流式响应（Chat），FastAPI 的 `StreamingResponse` + `async generator` 是最自然的写法。Flask 的流式响应需要 `generate()` 函数，不够优雅。

### 2.2 向量数据库：ChromaDB vs FAISS vs Milvus vs Pinecone

| 维度 | ChromaDB ✅ | FAISS | Milvus | Pinecone |
|------|------------|-------|--------|----------|
| 部署 | 嵌入式，零配置 | 嵌入式 | 需要 Docker | 云服务 |
| 持久化 | 内置 PersistentClient | 需手动 | 内置 | 云托管 |
| Python 原生 | ✅ | ✅ | 需 SDK | 需 SDK |
| 元数据过滤 | 支持 `where` 查询 | 不支持 | 支持 | 支持 |
| 适合场景 | 本地小规模 | 纯向量检索 | 大规模生产 | 托管服务 |

**选择 ChromaDB 的原因**：本地部署零配置，`PersistentClient` 自动持久化到磁盘，支持 metadata 过滤（如按 `item_id` 过滤），非常适合个人研究助手场景。

> **如果项目扩大**：10 万篇以上论文 → 考虑 Milvus；需要云托管 → Pinecone。

### 2.3 PDF 解析：MinerU vs PyMuPDF vs pdfplumber vs GROBID

| 维度 | MinerU ✅ | PyMuPDF | pdfplumber | GROBID |
|------|----------|---------|------------|--------|
| 布局分析 | ML 模型识别 | 无，逐页提取 | 表格检测 | ML 模型 |
| 多栏论文 | ✅ 正确阅读顺序 | ❌ 乱序 | 部分 | ✅ |
| 公式识别 | LaTeX 输出 | ❌ 纯文本 | ❌ | 部分 |
| 表格识别 | Markdown 表格 | `find_tables()` | ✅ | HTML |
| 速度 | 慢（ML 推理） | 极快 | 中等 | 慢 |
| 部署 | 云 API / 本地模型 | `pip install` | `pip install` | Docker |

**选择 MinerU + PyMuPDF 双引擎的原因**：
- MinerU 的 ML 布局分析对学术论文质量极高（正确识别多栏、公式、表格）
- PyMuPDF 作为轻量回退，在 MinerU API 不可用时保证功能不中断
- 通过 `Extractor` 抽象层实现可插拔切换

### 2.4 前端状态管理：Zustand vs Redux vs Context API

| 维度 | Zustand ✅ | Redux Toolkit | Context API |
|------|-----------|---------------|-------------|
| 代码量 | 极少（1 个 `create`） | 较多（slice + thunk） | 中等 |
| 异步操作 | 直接 `async` | 需要 thunk/saga | 手动 |
| 性能 | 自动精确订阅 | 需要 selector | 全量重渲染 |
| 中间件 | 内置 persist/devtools | 生态丰富 | 无 |

**选择 Zustand 的原因**：代码量极小，一个 `create()` 就是一个 store，无需 Provider 包裹，TypeScript 支持好。对于这种中等复杂度的项目，Redux 是过度设计。

### 2.5 CSS 方案：Tailwind CSS vs CSS Modules vs styled-components

| 维度 | Tailwind CSS ✅ | CSS Modules | styled-components |
|------|----------------|-------------|-------------------|
| 开发速度 | 极快（直接写 class） | 中等 | 中等 |
| 包体积 | PurgeCSS 自动清理 | 最小 | 较大 |
| 响应式 | 内置 `md:` `lg:` | 手动 media query | 手动 |
| 深色模式 | 内置 `dark:` | 手动 | 手动 |
| 可维护性 | HTML 较长 | 分离关注点 | 组件化 |

**选择 Tailwind 的原因**：深色模式只需加 `dark:` 前缀，响应式同理，配合 `@tailwindcss/typography` 插件处理 Markdown 渲染样式。

---

## 3. 后端架构详解

### 3.1 目录结构与分层

```
backend/
├── api/            ← 路由层：HTTP 请求 → 调用 Core → 返回响应
├── core/           ← 核心层：业务逻辑
│   ├── pipeline/   ←   文档处理管线
│   ├── rag/        ←   RAG 检索增强
│   ├── llm/        ←   LLM + Embedding 客户端
│   └── prompts/    ←   Prompt 模板管理
├── data/           ← 数据层：数据库操作
├── models/         ← 模型层：数据结构定义
├── extractors/     ← 提取器：PDF → 文本
└── config/         ← 配置：环境变量
```

**分层原则**：
- **API 层**不包含业务逻辑，只做请求解析和响应格式化
- **Core 层**不依赖 FastAPI，可以被 CLI、测试等其他入口调用
- **Data 层**只负责数据库 CRUD，不知道上层业务

### 3.2 FastAPI 应用启动流程

```python
# backend/main.py

# 1. 创建 FastAPI 实例
app = FastAPI(title="ZoteroSeek API", version="0.1.0")

# 2. 添加中间件（CORS 允许跨域，开发时前端在 5173，后端在 20801）
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)

# 3. 注册路由（每个路由文件是一个 APIRouter）
app.include_router(health_router, prefix="/api/v1")
app.include_router(index_router, prefix="/api/v1")
# ...

# 4. 挂载静态文件（React 构建产物，SPA fallback）
app.mount("/", StaticFiles(directory="static", html=True))

# 5. 启动 Uvicorn 服务器
uvicorn.run("backend.main:app", host="127.0.0.1", port=20801)
```

> **替代方案**：用 Gunicorn 做进程管理 + Uvicorn worker
> **为什么不用**：本地个人工具，单进程足够，不需要进程管理。

### 3.3 Pydantic Settings 配置管理

```python
# backend/config/settings.py

class Settings(BaseSettings):
    llm_api_key: str = ""           # 默认值
    llm_base_url: str = "https://api.openai.com/v1"
    
    class Config:
        env_prefix = "ZOTEROSEEK_"  # 环境变量前缀
        env_file = ROOT_DIR / ".env"  # 从 .env 文件加载

settings = Settings()  # 全局单例
```

**关键点**：
- `env_prefix = "ZOTEROSEEK_"` 意味着 `.env` 中的 `ZOTEROSEEK_LLM_API_KEY` 会映射到 `settings.llm_api_key`
- `settings` 是模块级变量，整个应用共享一个实例
- Pydantic 会自动校验类型（如果 `port` 写了字符串会报错）

> **替代方案**：用 `python-dotenv` + `os.getenv()`
> **为什么不用**：没有类型校验，没有 IDE 自动补全，没有默认值管理。

### 3.4 API 路由设计

```python
# backend/api/index.py

class IndexRequest(BaseModel):
    pdf_path: str
    item_id: str = "manual"
    extractor: str = "mineru"  # "mineru" | "pymupdf"

@router.post("/index", response_model=IndexResponse)
async def index_pdf(request: IndexRequest):
    """索引 PDF 文件"""
    # 1. 根据 extractor 参数选择提取器
    extractor = get_extractor(request.extractor)
    
    # 2. 初始化向量存储
    await vector_store.initialize()
    
    # 3. 构建 Pipeline 并执行
    pipeline = IngestionPipeline(extractor=extractor, ...)
    result = await pipeline.ingest(ctx)
    
    # 4. 返回结果
    return IndexResponse(success=result.success, ...)
```

**设计要点**：
- 请求/响应用 Pydantic `BaseModel` 定义，FastAPI 自动做 JSON 序列化和校验
- `response_model` 确保返回数据结构一致
- `async def` 异步处理，不阻塞事件循环

---

## 4. RAG Pipeline 详解

### 4.1 什么是 RAG？

**RAG = Retrieval-Augmented Generation（检索增强生成）**

```
用户提问 "STOCS 方法的原理是什么？"
    │
    ▼
┌─────────────────┐
│ 1. Embedding    │  将问题转为向量 [0.12, -0.34, 0.56, ...]
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. 向量检索      │  在 ChromaDB 中找到最相似的文档片段
│    (Retrieval)   │  返回 top-5 相关段落
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. Prompt 组装   │  把检索到的段落 + 用户问题组装成 Prompt
│    (Augment)     │  
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. LLM 生成      │  发送给 LLM，流式返回回答
│    (Generation)  │  LLM 基于检索到的上下文回答，带引用
└─────────────────┘
```

**为什么需要 RAG？**
- LLM 的训练数据有截止日期，不知道你最新的论文
- LLM 会"幻觉"——编造不存在的论文内容
- RAG 让 LLM 基于**你的真实文献**回答，可引用、可验证

### 4.2 Ingestion Pipeline（文档摄入管线）

```
PDF 文件
  │
  ▼
┌──────────────┐
│ Extract      │  PyMuPDF / MinerU 提取文本
│ (提取器)      │  → RawContent(content="...", content_type="pdf")
└──────┬───────┘
       ▼
┌──────────────┐
│ Parse        │  正则/Markdown 解析，识别学术分段
│ (解析器)      │  → CanonicalDocument(sections=[...])
└──────┬───────┘
       ▼
┌──────────────┐
│ Chunk        │  按语义分块（800 token，100 overlap）
│ (分块器)      │  → List[Chunk]（每个 chunk 有元数据）
└──────┬───────┘
       ▼
┌──────────────┐
│ Embed        │  调用 Embedding API 生成向量
│ (向量化)      │  → 每个 chunk 获得一个 1024/1536 维向量
└──────┬───────┘
       ▼
┌──────────────┐
│ Store        │  存入 ChromaDB（向量）+ SQLite（元数据）
│ (存储)        │  → 可搜索
└──────────────┘
```

### 4.3 Extractor 抽象层

```python
# backend/extractors/base.py

class RawContent(BaseModel):
    """所有提取器的统一输出格式"""
    content: str          # 提取的文本内容
    content_type: str     # "pdf" | "markdown" | "html"
    metadata: Dict        # 附加信息（页数等）
    page_count: int
    source_path: str

class Extractor(ABC):
    """提取器抽象基类 - 定义接口"""
    @abstractmethod
    async def extract(self, source: str, config: Dict = None) -> RawContent:
        ...  # 子类必须实现这个方法
    
    @abstractmethod
    def supports(self, source_type: str) -> bool:
        ...
```

**设计模式：策略模式 (Strategy Pattern)**

```python
# 两个具体实现
class PDFExtractor(Extractor):      # PyMuPDF 引擎
    async def extract(self, source, ...):
        doc = fitz.open(source)
        # 逐页提取文本...

class MinerUExtractor(Extractor):   # MinerU API 引擎
    async def extract(self, source, ...):
        # 调用 MinerU API → 获取 Markdown...
```

**使用时通过参数切换**：
```python
EXTRACTORS = {"mineru": MinerUExtractor, "pymupdf": PDFExtractor}
extractor = EXTRACTORS[request.extractor]()  # 工厂模式
```

> **替代方案**：不用抽象，直接 `if/else` 切换
> **为什么不用**：违反开闭原则（OCP），新增提取器要改已有代码。用抽象层只需新增一个类。

### 4.4 SemanticChunker（语义分块器）

**为什么需要分块？**
- Embedding 模型有 token 上限（通常 8192 token）
- 太长的文本 → 向量质量下降
- 太短的文本 → 丢失上下文
- 800 token + 100 token overlap 是经验最优值

**分块策略**：
```
Section: "ABSTRACT" (假设 2000 token)
  │
  ├─ 按段落拆分：["para1(300t)", "para2(250t)", "para3(400t)", ...]
  │
  ├─ 累积到 800 token → 输出 chunk_1
  │   overlap: 取 chunk_1 末尾 100 token → 放到 chunk_2 开头
  │
  ├─ 继续累积 → 输出 chunk_2
  │
  └─ 最后不足 min_chunk_tokens 的尾部 → 合并到上一个 chunk
```

**Markdown 感知分块**：
- 不在 `$$...$$`（公式块）中间断开
- 不在 ` ```...``` `（代码块）中间断开
- 不在 `|...|`（表格）中间断开
- 连续列表项（`- item`）保持在一起

### 4.5 向量检索与相似度

```python
# backend/data/chroma_store.py

async def query(self, vector, top_k=5, filters=None):
    results = self.collection.query(
        query_embeddings=[vector],
        n_results=top_k,
        where=filters,        # 可选：按 item_id 过滤
        include=["documents", "metadatas", "distances"],
    )
    # ChromaDB 返回的是 cosine distance (0~2)
    # 转换为 similarity: score = 1 - distance
    # 完全相同 = 1.0，完全无关 ≈ 0.0，相反 = -1.0
    return [VectorResult(score=1 - distance, ...) for ...]
```

**余弦相似度 (Cosine Similarity) 直觉理解**：
- 把文本想象成高维空间中的一个箭头
- 两个箭头越指向同一方向 → 相似度越高
- "STOCS 方法" 和 "空间社区检测算法" 的箭头方向接近 → score ≈ 0.7
- "STOCS 方法" 和 "今天的天气" 的箭头方向几乎垂直 → score ≈ 0.1

### 4.6 RAG 对话流程

```python
# backend/api/chat.py

# 1. 用户提问
request.message = "What is STOCS?"

# 2. 检索相关文档片段
augmented_prompt, sources = await chat_integration.augment_query(
    query="What is STOCS?", top_k=5
)
# augmented_prompt 实际内容：
# "### Context from Papers:\n[1. Detecting spatial... - abstract]\n
#  This paper presents STOCS...\n\n### Question:\nWhat is STOCS?"

# 3. 构建消息
messages = [
    {"role": "system", "content": "You are ZoteroSeek...cite with [^N^]"},
    {"role": "user", "content": augmented_prompt},  # 包含检索到的上下文
]

# 4. 流式调用 LLM
async for chunk in llm_client.chat(messages, stream=True):
    yield f"data: {chunk}\n\n"  # SSE 格式发送给前端

# 5. 发送引用来源
yield f"sources: {json.dumps(sources_data)}\n\n"
yield "data: [DONE]\n\n"
```

**SSE (Server-Sent Events) 协议**：
```
data: STO
data: CS is
data:  an analytical
data:  framework...
sources: [{"index":1,"title":"Detecting...","score":0.702}]
data: [DONE]
```

前端逐个接收 `data:` 行，实时拼接显示，实现"打字机"效果。

---

## 5. 前端架构详解

### 5.1 组件结构

```
App.tsx                    ← 根组件：导航栏 + 路由
├── SessionSidebar.tsx     ← 会话列表侧边栏
├── Chat.tsx               ← 聊天界面
│   ├── ReactMarkdown      ← Markdown 渲染
│   └── SourcesPanel       ← 引用来源面板
├── Library.tsx            ← 文献库管理
└── Search.tsx             ← 语义搜索
```

### 5.2 状态管理：Zustand Store

```typescript
// frontend/src/stores/chatStore.ts

export const useChatStore = create<ChatState>((set) => ({
  isLoading: false,

  sendMessage: async (content: string) => {
    const sessionStore = useSessionStore.getState()
    
    // 1. 添加用户消息到当前会话
    sessionStore.addMessage({ role: 'user', content })
    // 2. 添加 assistant 占位（显示 thinking 动画）
    sessionStore.addMessage({ role: 'assistant', content: '' })
    set({ isLoading: true })

    let assistantContent = ''
    
    // 3. 流式接收 LLM 回答
    await apiClient.chat(content, (chunk) => {
      assistantContent += chunk
      sessionStore.updateLastMessage(assistantContent)
    })

    set({ isLoading: false })
  },
}))
```

**Zustand vs Redux 的关键区别**：
- Zustand：`const store = create(...)` 直接创建，无需 Provider
- Redux：需要 `<Provider store={store}>` 包裹，需要 slice + reducer + action

### 5.3 SSE 流式通信

```typescript
// frontend/src/api/client.ts

chat: async (message, onChunk, onSources) => {
  const response = await fetch('/api/v1/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        onChunk(line.slice(6))  // 回调给 UI
      } else if (line.startsWith('sources: ')) {
        onSources(JSON.parse(line.slice(9)))
      }
    }
  }
}
```

**为什么用 `fetch` 而不是 `axios`？**
- axios 不原生支持 `ReadableStream` 读取
- SSE 流式需要 `response.body.getReader()` — 这是 Web Streams API
- 其他 REST 接口仍然用 axios（更方便的拦截器和错误处理）

### 5.4 Liquid Glass 设计实现

```tsx
// 导航栏毛玻璃效果
<div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-2xl shadow-lg">

// 流动 tab 指示器
<div
  className="absolute bg-white/90 rounded-lg shadow-sm transition-all duration-300 
             ease-[cubic-bezier(0.4,0,0.2,1)]"
  style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
/>

// 悬浮输入框
<div className="bg-white/60 backdrop-blur-2xl shadow-xl border border-white/30 rounded-2xl">
```

**关键 CSS 属性**：
- `backdrop-blur-xl`：背景模糊（毛玻璃核心）
- `bg-white/60`：60% 不透明度白色背景
- `border-white/20`：20% 不透明度边框（半透明）
- `shadow-xl`：大阴影（悬浮感）
- `cubic-bezier(0.4,0,0.2,1)`：Material Design 标准缓动曲线

---

## 6. Zotero 插件架构

### 6.1 生命周期

```
Zotero 启动
  │
  ▼
bootstrap.js::startup()
  ├─ 注册 chrome 映射
  ├─ 加载 TypeScript 编译产物 (zoteroseek.js)
  └─ 调用 addon.hooks.onStartup()
       ├─ 注册偏好设置面板
       ├─ 创建工具栏按钮
       └─ launcher.start() → 检测后端是否运行 → 打开浏览器
```

### 6.2 为什么是"极薄"插件？

插件**不做任何计算**，只做三件事：
1. 启动时检查后端是否运行，打开浏览器
2. 存储用户配置（`Zotero.Prefs`）
3. 提供工具栏入口

> **替代方案**：在插件内运行 React + 调用 LLM（像 Zotero-GPT）
> **为什么不用**：Zotero 9 的沙盒环境会阻塞主线程，React 渲染会导致 Zotero 卡死。分离架构让插件永远不阻塞。

---

## 7. 数据流全链路

### 7.1 PDF 索引流程

```
用户在前端点击 "Index All PDFs"
  │
  ▼
POST /api/v1/index-zotero
  │
  ├─ 调用 Zotero API (localhost:23119) 获取文献列表
  ├─ 过滤出有 PDF 附件的条目
  ├─ 对每个 PDF：
  │    ├─ MinerUExtractor.extract(pdf_path)
  │    │    ├─ POST mineru.net/api/v1/agent/parse/file → task_id
  │    │    ├─ PUT oss_url (上传 PDF)
  │    │    ├─ GET mineru.net/api/v1/agent/parse/{task_id} → 轮询
  │    │    └─ GET cdn_url → 返回 Markdown 文本
  │    │
  │    ├─ DocumentParser.parse(markdown)
  │    │    ├─ 按 #/## 标题拆分 sections
  │    │    ├─ 识别 SectionType (ABSTRACT, METHODS, ...)
  │    │    └─ 提取 metadata (title, authors)
  │    │
  │    ├─ SemanticChunker.chunk(document)
  │    │    ├─ 每个 section → 按段落分块 (800 token)
  │    │    └─ overlap 策略 (100 token)
  │    │
  │    ├─ EmbeddingClient.embed(texts)
  │    │    └─ POST siliconflow.cn/v1/embeddings → 向量
  │    │
  │    └─ ChromaVectorStore.upsert(ids, embeddings, documents, metadatas)
  │
  └─ 返回 {success: 7, failed: 0, total: 7}
```

### 7.2 RAG 对话流程

```
用户输入 "What is STOCS?"
  │
  ▼
POST /api/v1/chat (SSE)
  │
  ├─ EmbeddingClient.embed_single("What is STOCS?")
  │    → query_vector = [0.12, -0.34, ...]
  │
  ├─ ChromaVectorStore.query(query_vector, top_k=5)
  │    → [
  │        {content: "STOCS is...", score: 0.702, section: "abstract"},
  │        {content: "The method...", score: 0.668, section: "introduction"},
  │        ...
  │      ]
  │
  ├─ PromptRegistry.render("rag_research", context=..., question=...)
  │    → system: "You are ZoteroSeek..."
  │    → user: "### Context:\n[1. ...]\n### Question:\nWhat is STOCS?"
  │
  ├─ LLMClient.chat(messages, stream=True)
  │    → POST xiaomimimo.com/v1/chat/completions
  │    → 流式返回 tokens
  │
  └─ SSE → 前端实时显示
       data: STO
       data: CS is
       data:  an analytical...
       sources: [...]
       data: [DONE]
```

---

## 8. 设计模式与工程实践

### 8.1 使用的设计模式

| 模式 | 应用位置 | 作用 |
|------|---------|------|
| **策略模式** | `Extractor` 抽象层 | 可插拔切换 PDF 解析引擎 |
| **工厂模式** | `get_extractor(name)` | 根据名称创建提取器实例 |
| **模板方法** | `IngestionPipeline.ingest()` | 固定 5 步流程，每步可替换 |
| **依赖注入** | Pipeline 构造函数 | 组件通过参数注入，不硬编码 |
| **单例模式** | `settings = Settings()` | 全局配置唯一实例 |
| **观察者模式** | Zustand `set()` | 状态变更自动通知订阅者 |
| **Builder 模式** | PromptRegistry.render() | 模板 + 变量 → 完整 Prompt |

### 8.2 异步编程

```python
# 同步版本（阻塞）
def get_data():
    response = requests.get(url)  # 阻塞等待
    return response.json()

# 异步版本（非阻塞）✅
async def get_data():
    async with httpx.AsyncClient() as client:
        response = await client.get(url)  # 挂起，让出事件循环
        return response.json()
```

**为什么重要？**
- FastAPI 运行在 asyncio 事件循环上
- 如果用同步 I/O（`requests`），一个请求阻塞时，所有其他请求都得等
- 异步 I/O（`httpx`）在等待网络响应时，可以处理其他请求

### 8.3 错误处理策略

```python
# API 层：捕获所有异常，返回友好错误
@router.post("/index")
async def index_pdf(request: IndexRequest):
    try:
        result = await pipeline.ingest(ctx)
        return IndexResponse(success=result.success, ...)
    except ValueError as e:
        return IndexResponse(success=False, error=str(e))  # 业务错误
    except Exception as e:
        logger.exception(f"[Index] 索引失败: {e}")
        return IndexResponse(success=False, error="Internal error")  # 系统错误

# Pipeline 层：返回 Result 对象，不抛异常
async def ingest(self, ctx) -> PipelineResult:
    try:
        # ... 执行管线
        return PipelineResult(success=True, ...)
    except Exception as e:
        return PipelineResult(success=False, error=str(e))  # 包装错误
```

---

## 9. 已知问题与改进方向

### 9.1 当前限制

| 问题 | 原因 | 改进方向 |
|------|------|----------|
| MinerU 限制 20 页 | Agent 轻量 API 限制 | 使用精准解析 API（需 Token） |
| 同步 SQLAlchemy 在 async handler 中 | SQLite 不支持异步 | 使用 `run_in_executor` 或 `aiosqlite` |
| 每次请求重建 ChromaDB Client | 无幂等保护 | 加 `if self.client: return` |
| Chat sources 不显示引用原文 | 只传了 title/score | 传完整 content_preview |

### 9.2 可扩展方向

- **Zotero 双向同步**：自动检测 Zotero 库变化，增量索引
- **多文档对比**：同时检索多篇论文，对比方法/结果
- **引用图谱**：基于论文引用关系构建知识图谱
- **笔记集成**：将 Zotero 笔记也纳入 RAG 检索

---

## 10. 面试常见问题

### Q: 为什么用 RAG 而不是微调模型？

**A**: RAG 的优势：
1. **实时性**：新增论文立即可检索，无需重新训练
2. **可解释性**：回答附带引用来源，可验证
3. **成本低**：不需要 GPU 训练，只需调 API
4. **通用性**：换一个 Embedding 模型就能用，不绑定特定 LLM

### Q: 如何保证检索质量？

**A**: 三层保障：
1. **MinerU 结构化解析**：正确识别论文分段（Abstract/Methods/...），保留标题语义
2. **语义分块**：800 token + 100 overlap 确保上下文连贯
3. **分段元数据**：每个 chunk 带 `section_type`，搜索时可以按分段类型加权

### Q: 如何处理 LLM 幻觉？

**A**: 
1. Prompt 中明确要求 "Only answer based on the provided context"
2. 强制引用格式 `[^N^]`，每个引用对应真实检索到的文档片段
3. 前端显示 Sources 面板，用户可点击查看原文

### Q: 为什么前后端分离而不是 SSR？

**A**:
1. 后端需要长时间运行（PDF 解析可能几分钟），不适合 SSR
2. SSE 流式响应需要持久 HTTP 连接
3. 前端部署为静态文件嵌入后端，无需额外 web 服务器

### Q: 如何扩展到团队使用？

**A**:
1. 替换 ChromaDB 为 Milvus（支持分布式）
2. 替换 SQLite 为 PostgreSQL
3. 添加用户认证（JWT）
4. 前端独立部署，后端容器化

---

## 附录：关键代码文件索引

| 文件 | 内容 | 行数 |
|------|------|------|
| `backend/main.py` | FastAPI 应用入口 | ~50 |
| `backend/config/settings.py` | Pydantic Settings 配置 | ~40 |
| `backend/api/index.py` | PDF 索引端点（Extractor 选择） | ~60 |
| `backend/api/chat.py` | RAG 对话端点（SSE 流式） | ~70 |
| `backend/api/zotero.py` | Zotero 集成端点 | ~250 |
| `backend/extractors/base.py` | Extractor 抽象基类 | ~25 |
| `backend/extractors/mineru_extractor.py` | MinerU API 提取器 | ~180 |
| `backend/extractors/pdf.py` | PyMuPDF 提取器 | ~35 |
| `backend/core/pipeline/ingestion.py` | Pipeline 编排器 | ~70 |
| `backend/core/pipeline/parser.py` | Markdown 感知解析器 | ~200 |
| `backend/core/pipeline/chunker.py` | Markdown 感知分块器 | ~150 |
| `backend/core/rag/retriever.py` | 向量检索器 | ~40 |
| `backend/core/rag/chat_integration.py` | RAG Prompt 组装 | ~60 |
| `backend/core/llm/client.py` | LLM 客户端（流式） | ~80 |
| `backend/core/llm/embeddings.py` | Embedding 客户端 | ~40 |
| `backend/data/chroma_store.py` | ChromaDB 向量存储 | ~70 |
| `backend/data/models.py` | SQLAlchemy ORM 模型 | ~30 |
| `frontend/src/App.tsx` | 根组件（导航 + 布局） | ~150 |
| `frontend/src/views/Chat.tsx` | 聊天界面 | ~200 |
| `frontend/src/stores/chatStore.ts` | 聊天状态管理 | ~50 |
| `frontend/src/stores/sessionStore.ts` | 会话管理 | ~120 |
| `frontend/src/api/client.ts` | API 客户端 | ~100 |
| `frontend/src/stores/sessionStore.ts` | 会话管理 + localStorage 持久化 | ~200 |
| `plugin/src/index.ts` | 插件入口 | ~65 |
| `plugin/src/bridge.ts` | HTTP 桥接 | ~60 |
| `plugin/src/launcher.ts` | 后端启动器 | ~50 |
| `backend/api/shared_deps.py` | 共享依赖单例 | ~40 |

---

## 11. 工程质量问题清单与修复记录

### 11.1 共享依赖管理（shared_deps.py）

**问题**：chat.py、search.py、index.py 各自独立创建 `EmbeddingClient()`、`ChromaVectorStore()` 等实例，每次请求都调用 `initialize()`。

**修复**：抽取 `backend/api/shared_deps.py`，模块级单例 + 幂等初始化：

```python
# backend/api/shared_deps.py
embedder = EmbeddingClient()
vector_store = ChromaVectorStore()
_vector_store_initialized = False

async def ensure_vector_store():
    """幂等初始化 — 只在首次调用时执行"""
    global _vector_store_initialized
    if not _vector_store_initialized:
        await vector_store.initialize()
        _vector_store_initialized = True
```

> **替代方案**：用 FastAPI 的 `Depends()` + `@lru_cache` 做依赖注入
> **为什么不用**：当前架构冻结，shared_deps 已足够简洁，Depends 需要改更多代码。

### 11.2 asyncio.to_thread() 避免阻塞

**问题**：`PDFExtractor.extract()` 是 `async def`，但内部 `fitz.open()` 和 `page.get_text()` 是同步阻塞调用，会阻塞 FastAPI 事件循环。

**修复**：
```python
async def extract(self, source, config=None):
    # 将阻塞调用放到线程池
    full_text, page_count = await asyncio.to_thread(self._extract_sync, source)
    ...

@staticmethod
def _extract_sync(source: str) -> tuple[str, int]:
    doc = fitz.open(source)
    # ... 同步提取
```

> **替代方案**：用 `run_in_executor(None, ...)` — 效果相同但语法更冗长
> **为什么用 to_thread**：Python 3.9+ 推荐写法，语义更清晰。

### 11.3 Pydantic v2 迁移

**问题**：使用了 Pydantic v1 的 `class Config` 风格。

**修复**：
```python
# v1（旧）
class Settings(BaseSettings):
    class Config:
        env_prefix = "ZOTEROSEEK_"
        env_file = ROOT_DIR / ".env"

# v2（新）
class Settings(BaseSettings):
    model_config = {
        "env_prefix": "ZOTEROSEEK_",
        "env_file": str(ROOT_DIR / ".env"),
    }
```

### 11.4 FastAPI lifespan 替代 on_event

**问题**：`@app.on_event("startup")` 已被 FastAPI 标记为废弃。

**修复**：
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()  # 启动时初始化数据库
    yield       # 应用运行中
    # 这里可以添加清理逻辑

app = FastAPI(lifespan=lifespan)
```

### 11.5 Embedding 分批策略

**问题**：`embed()` 一次性发送所有文本，大批量时可能触达 API 限制。

**修复**：默认 `batch_size=20`，循环分批发送：
```python
for i in range(0, len(texts), self.batch_size):
    batch = texts[i:i + self.batch_size]
    response = await client.post(...)
```

---

## 12. 项目中的 Agent 能力总结

### 为什么这是一个 Agent 项目？

很多人把"调用了 LLM API"说成是"做了 Agent"——这是误解。**Agent 的核心是自主规划 + 工具调用 + 多步执行**。ZoteroSeek 中有三个层次的 Agent 能力：

**第一层：文档理解 Agent**
```
PDF → 自动选择解析引擎 → 自动识别学术分段 → 自动语义分块 → 自动向量化 → 自动存储
```
每一步可插拔替换（策略模式），失败自动回退。

**第二层：检索 Agent**
```
用户提问 → 自动向量化 → 自动检索最相关文档 → 自动组装结构化 Prompt
```
自主决策检索数量（top_k）、上下文格式、引用方式。

**第三层：生成 Agent**
```
LLM 基于真实文献生成回答 → 强制引用格式 [^N^] → 前端可溯源验证
```

### 简历项目描述

> **ZoteroSeek — 本地 AI 学术研究助手**
> 技术栈：Python / FastAPI / ChromaDB / React / TypeScript / MinerU
>
> 设计并实现了基于 RAG 架构的本地 AI 研究助手，以 Zotero 文献库为数据源，支持学术论文的语义检索和智能问答。
>
> - **RAG 检索增强生成**：Embedding 向量化 + ChromaDB 语义检索 + Prompt 工程，实现基于私有文献库的问答，回答附带可验证引用，抑制 LLM 幻觉
> - **多步工具编排**：集成 MinerU 文档解析 API，实现异步任务编排（提交→上传→轮询→下载），支持结构化 Markdown 输出
> - **可插拔管线设计**：5 阶段处理管线（Extract→Parse→Chunk→Embed→Store），采用策略模式，支持 MinerU / PyMuPDF 双引擎热切换
> - **全栈实现**：FastAPI 后端（SSE 流式响应）+ React 前端（Liquid Glass UI）+ Zotero 插件（极薄桥接层）
