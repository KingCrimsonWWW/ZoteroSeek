# 05 — 工程实践

## 测试架构

### 测试策略

```
单元测试 (test_pipeline.py)    ← 纯逻辑，零 mock
集成测试 (test_api.py)         ← FastAPI TestClient，部分 mock
工具测试 (test_tools.py)       ← LangChain Tool 注册 + Schema 校验
```

### 测试框架：pytest + pytest-asyncio

```python
# pyproject.toml
[project.optional-dependencies]
dev = ["pytest>=7.4.0", "pytest-asyncio>=0.21.0"]

# 运行
uv run --project backend python -m pytest backend/tests/ -v
```

### 测试示例

```python
# 单元测试 — Parser
def test_parse_markdown_section_types():
    raw = RawContent(
        content="# Paper\n\n## ABSTRACT\n\nText.\n\n## METHODS\n\nText.",
        content_type="markdown",
    )
    doc = parser.parse(raw, "test")
    types = {s.section_type for s in doc.sections}
    assert SectionType.ABSTRACT in types
    assert SectionType.METHODS in types

# 集成测试 — API
def test_health_returns_ok(client):  # client 是 FastAPI TestClient fixture
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

# 工具测试 — Agent Tools
def test_search_knowledge_schema():
    schema = search_knowledge.args_schema.model_json_schema()
    assert 'query' in schema['properties']
```

---

## CI/CD

### GitHub Actions 工作流

```yaml
# .github/workflows/build.yml
name: Build and Test
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm install --legacy-peer-deps
      - run: npm run lint         # ESLint
      - run: npm run typecheck    # TypeScript 编译检查
      - run: npm run build        # 插件构建 → .xpi
```

**每次 push 自动执行**：lint → typecheck → build → upload artifact

---

## 设计模式

| 模式 | 应用位置 | 作用 |
|------|---------|------|
| **策略模式** | `Extractor` ABC | 可插拔切换 MinerU / PyMuPDF |
| **工厂模式** | `EXTRACTORS` dict + `get_extractor()` | 根据名称创建提取器 |
| **模板方法** | `IngestionPipeline.ingest()` | 固定 5 步流程，每步可替换 |
| **依赖注入** | Pipeline 构造函数 | 组件通过参数注入 |
| **单例模式** | `shared_deps.py` + `settings` | 全局唯一实例 |
| **观察者模式** | Zustand `set()` | 状态变更自动通知 |
| **ReAct 模式** | LangGraph Agent | 思考→工具→观察→回答循环 |

---

## 异步编程

```python
# 同步阻塞（错误示范）
def get_data():
    response = requests.get(url)  # 阻塞整个事件循环
    return response.json()

# 异步非阻塞（正确）
async def get_data():
    async with httpx.AsyncClient() as client:
        response = await client.get(url)  # 挂起，让出事件循环
        return response.json()

# 同步库包裹为异步（PDF 提取）
async def extract(self, source):
    full_text, page_count = await asyncio.to_thread(self._extract_sync, source)
    # asyncio.to_thread 将阻塞调用放到线程池
```

---

## 错误处理策略

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
        logger.exception(f"[Index] Error: {e}")
        return IndexResponse(success=False, error="Internal error")

# Pipeline 层：返回 Result 对象，不抛异常
async def ingest(self, ctx) -> PipelineResult:
    try:
        return PipelineResult(success=True, ...)
    except Exception as e:
        return PipelineResult(success=False, error=str(e))
```

---

## 代码质量

| 工具 | 用途 | 配置 |
|------|------|------|
| ESLint | TypeScript/JS 代码检查 | `eslint.config.js` |
| TypeScript strict | 类型安全 | `tsconfig.json` |
| Pydantic | Python 数据校验 | 所有 API 请求/响应模型 |
| loguru | 结构化日志 | `logger.info/error/exception` |
| pytest | 单元/集成测试 | `backend/tests/` |

---

## 依赖管理

```
Python: uv (pyproject.toml + uv.lock)
  - uv sync          # 安装依赖
  - uv run python    # 运行 Python
  - uv lock          # 更新锁文件

Node: npm (package.json + package-lock.json)
  - npm install      # 安装依赖
  - npm run build    # 构建
  - npm run lint     # 检查
```

---

## 数据流全链路

### PDF 索引流程

```
用户点击 "Index All PDFs"
  → POST /api/v1/index-zotero
  → Zotero API (localhost:23119) 获取文献列表
  → 过滤 PDF 附件
  → 对每个 PDF：
      → MinerUExtractor.extract(pdf_path)
          → POST mineru.net/api/v1/agent/parse/file → task_id
          → PUT oss_url (上传 PDF)
          → GET /api/v1/agent/parse/{task_id} (轮询)
          → GET cdn_url → Markdown
      → DocumentParser.parse(markdown)
          → 按 #/## 标题分段
          → 识别 SectionType
      → SemanticChunker.chunk(document)
          → 800 token + 100 overlap
      → EmbeddingClient.embed(texts)
          → POST siliconflow.cn/v1/embeddings → 向量
      → ChromaVectorStore.upsert()
  → 返回 {success: 7, failed: 0}
```

### RAG 对话流程

```
用户输入 "What is STOCS?"
  → POST /api/v1/chat (SSE)
  → LangGraph Agent 启动 ReAct 循环
  → LLM 决定调用 search_knowledge("STOCS method")
  → Tool: embed query → ChromaDB 检索 → 返回 top-5 片段
  → LLM 基于检索结果生成回答
  → SSE 流式返回 → 前端实时显示
  → sources: [{title, section, score}]
  → data: [DONE]
```
