# ZoteroSeek 重建计划

> 本文件是唯一输入。执行时不需要任何先前对话上下文；文中出现的每个路径、端口、字段都可直接照做。

## 0. 本文件的使用方式

1. 按 §6 的 Phase 顺序执行，每个 Phase 结束先跑该 Phase 的「验收」，不通过不进入下一 Phase。
2. 接口、提示词、Schema 以 §5 为准，不得自行改写字段名。
3. 外部系统的 API 细节（Zotero 本地接口、MinerU 提交/轮询接口）以本机两个 skill 的文档为依据：`zotero` skill 与 `mineru` skill。执行 Phase 1 前先读这两份文档，不要凭记忆写接口。
4. DSH 插件部分以本机 `dsh-doc` skill 的 `references/host-plugin.md`、`references/ui-plugin.md`、`references/practices.md`、`references/verification.md` 为依据。

---

## 1. 目标与非目标

### 目标

一个本地文献问答系统，Zotero 作为只读数据源，MinerU 作为唯一 PDF 解析器，DSH 作为唯一宿主（插件形态）。系统有两套模式：

- **模式 A（自研循环）**：自己实现的工具调用循环，检索 → 带引用作答。全部代码可控、可评测。
- **模式 B（深度模式）**：把任务交给本机已安装的 coding CLI（`claude` / `codex`），流式回显。

### 非目标（明确不做）

- 不做 Zotero 插件、不做 Obsidian 插件、不做独立 Web 应用外壳
- 不做 PDF 双引擎回退（MinerU 失败即失败）
- 不做多轮对话记忆、子代理、多用户、鉴权、Docker
- 不做对 Zotero 的写操作（不加标签、不改条目、不写回）
- 不做向量库选型对比、不做多 embedding 模型对比

---

## 2. 前置条件

| 项 | 要求 | 验证命令 |
|---|---|---|
| Python | 3.12+，用 `uv` 管理 | `uv --version` |
| Node | 20+（DSH 插件构建） | `node -v` |
| DSH | 已安装并运行，Web GUI 可访问 | 浏览器打开当前 DSH 地址 |
| Zotero | 7.x 运行中，已开启本地 API（设置 → 高级 → 允许其他应用与 Zotero 通信） | `curl http://127.0.0.1:23119/api/users/0/items?limit=1` 返回 JSON |
| MinerU | 有 API Token | 环境变量可读 |
| LLM | OpenAI 兼容接口（base_url + key + model） | `curl $BASE/models -H "Authorization: Bearer $KEY"` |
| 磁盘 | ≥ 15 GB 空闲（模型权重 + 索引） | — |

工作目录：`E:\TheCode\ZoteroSeek`（git 仓库，远端 `origin`）。

---

## 3. 架构

```
┌──────────────────────── DSH（Electron 宿主） ────────────────────────┐
│  Client 插件：文献库面板（列表 / 聊天 / 模式切换 / 流式渲染）          │
│  Host 插件：4 个工具 search_library / get_chunk / index_paper /       │
│              deep_research                                            │
└─────────────────────────┬─────────────────────────────────────────────┘
                          │ HTTP + SSE  (127.0.0.1:20801)
┌─────────────────────────▼─────────────────────────────────────────────┐
│  Python sidecar（FastAPI）                                             │
│   · Zotero 本地 API 客户端（只读）                                     │
│   · MinerU 解析（唯一解析器）                                          │
│   · 分块 → 本地 embedding → Chroma                                     │
│   · 检索：dense → rerank                                               │
│   · 模式 A：自研工具调用循环 + 引用子集校验                            │
│   · 模式 B：spawn CLI 适配器，stdout 转 SSE                            │
│   · 评测：25 条 QA 集 → Recall@5 / 引用准确率 → 报告                   │
└───────────────────────────────────────────────────────────────────────┘
                          │
              Zotero 本地 API（:23119） + Zotero storage 目录
```

### 组件职责

| 组件 | 负责 | 不负责 |
|---|---|---|
| DSH 插件 | 界面、把工具调用转发给 sidecar | 解析、检索、循环 |
| sidecar | 解析、索引、检索、循环、评测、拉起 CLI | 界面 |
| Zotero | 提供条目元数据与附件路径 | 一切计算 |

---

## 4. 目录结构

```
E:\TheCode\ZoteroSeek\
├─ README.md                      # 重写：架构图 + 两条启动命令 + 评测结果
├─ BUILD_PLAN.md                  # 本文件
├─ .gitignore                     # 见 Phase 0
├─ app/
│  ├─ pyproject.toml
│  ├─ .env.example
│  ├─ server/
│  │  ├─ main.py                  # FastAPI 装配、CORS、静态托管前端
│  │  ├─ deps.py                  # 单例装配（store / retriever / llm / loop）
│  │  ├─ sse.py                   # SSE 事件编码
│  │  └─ routes/
│  │     ├─ library.py            # GET  /api/library
│  │     ├─ index.py              # POST /api/index
│  │     ├─ chat.py               # POST /api/chat
│  │     ├─ deep.py               # POST /api/deep
│  │     └─ eval.py               # POST /api/eval
│  ├─ core/
│  │  ├─ config.py                # pydantic-settings，前缀 ZOTEROSEEK_
│  │  ├─ zotero.py                # 本地 API 客户端
│  │  ├─ mineru.py                # 提交 → 上传 → 轮询 → 下载
│  │  ├─ chunker.py               # Markdown 感知，800/100
│  │  ├─ store.py                 # sqlite（元数据）+ chroma（向量）
│  │  ├─ embed.py                 # 本地 embedding（sentence-transformers）
│  │  ├─ rerank.py                # 本地 CrossEncoder
│  │  ├─ retriever.py             # dense → rerank → SearchHit
│  │  ├─ llm.py                   # OpenAI 兼容客户端（tools + stream）
│  │  ├─ tools.py                 # 工具注册表（4 个）
│  │  ├─ prompt.py                # 系统提示词常量（§5.5 原文）
│  │  ├─ loop.py                  # 模式 A 循环
│  │  ├─ guards.py                # 引用子集 / 参数校验 / 预算
│  │  └─ harness.py               # 模式 B 适配器
│  ├─ eval/
│  │  ├─ qa_set.jsonl             # 25 条，人工标注
│  │  ├─ run_eval.py              # 生成报告
│  │  └─ reports/                 # 产物（git 忽略）
│  ├─ data/                       # sqlite + chroma（git 忽略）
│  └─ tests/
│     ├─ test_chunker.py
│     ├─ test_retriever.py
│     ├─ test_guards.py
│     └─ test_api.py
└─ dsh-plugin/
   ├─ package.json
   ├─ cordis.patch.yml
   ├─ locale/
   ├─ docs/DETAIL.md
   ├─ icon.svg
   ├─ host/index.ts               # 4 工具 → sidecar
   └─ client/index.ts             # 面板 slot
```

---

## 5. 接口契约

### 5.1 数据模型

```python
# 条目：来自 Zotero
Item(key: str, title: str, year: int|None, creators: list[str],
     attachment_path: str|None, indexed: bool)

# 分块
Chunk(chunk_id: str,          # f"{item_key}:{seq:04d}"
      item_key: str,
      title: str,
      section: str,           # 章节标题路径，如 "Methods > 2.1"
      text: str,
      token_estimate: int)

# 检索命中
SearchHit(chunk_id: str, item_key: str, title: str, section: str,
          text: str, dense_score: float, rerank_score: float|None)
```

### 5.2 HTTP API（base `http://127.0.0.1:20801`）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/health` | — | `{"ok": true, "indexed": 12, "chunks": 340}` |
| GET | `/api/library` | `?query=&limit=` | `Item[]` |
| POST | `/api/index` | `{"item_key": "ABCD1234"}` | `{"item_key","chunks","ms"}` |
| POST | `/api/chat` | `{"question","item_key"?}` | SSE（见 5.3） |
| POST | `/api/deep` | `{"task","item_keys":[]}` | SSE（见 5.3） |
| POST | `/api/eval` | `{"rollout": "baseline"\|"rerank"}` | `{"report_path"}` |

### 5.3 SSE 事件

统一形状 `event: <name>\ndata: <json>\n\n`：

| event | data |
|---|---|
| `step` | `{"n": 1, "kind": "tool", "name": "search_library", "args": {...}}` |
| `retrieved` | `{"chunks": [{"chunk_id","title","section","score"}]}` |
| `delta` | `{"text": "..."}` （最终答案增量） |
| `final` | `{"answer","citations":[{"n":1,"chunk_id":...}],"usage":{"steps","tokens"}}` |
| `error` | `{"message"}` |

### 5.4 工具 JSON Schema（4 个，名称不可改）

```json
[
  {"name": "search_library",
   "description": "在已索引的文献库里做语义检索，返回最相关的片段。",
   "parameters": {"type": "object", "properties": {
     "query": {"type": "string"},
     "top_k": {"type": "integer", "default": 8, "minimum": 1, "maximum": 20},
     "item_key": {"type": "string", "description": "只在该文献内检索时填"}
   }, "required": ["query"]}},

  {"name": "get_chunk",
   "description": "按 chunk_id 取回完整片段；检索结果被截断时使用。",
   "parameters": {"type": "object", "properties": {
     "chunk_id": {"type": "string"}
   }, "required": ["chunk_id"]}},

  {"name": "index_paper",
   "description": "用 MinerU 解析指定文献的 PDF 并入库。仅当用户要求分析某篇未入库文献时调用。",
   "parameters": {"type": "object", "properties": {
     "item_key": {"type": "string"}
   }, "required": ["item_key"]}},

  {"name": "deep_research",
   "description": "把需要多步改文件、跑命令的任务交给本机 coding CLI 执行。返回流式输出。",
   "parameters": {"type": "object", "properties": {
     "task": {"type": "string"},
     "item_keys": {"type": "array", "items": {"type": "string"}}
   }, "required": ["task"]}}
]
```

### 5.5 系统提示词（模式 A，逐字使用）

```
你是 ZoteroSeek，一个面向个人文献库的检索问答助手。

## 回答规范
- 始终用简体中文回答。
- 只有在本次会话调用过 search_library 且拿到结果时，才允许引用，格式为 [^N^]，N 为检索结果序号，从 1 开始。
- 没有检索到相关内容时，直接回答"文献库中没有相关内容"，并说明可以先用 index_paper 索引哪篇文献。
- 不要编造文献标题、作者、年份、页码。

## 检索约定
- 用户提到"这篇/这几篇"时，先确认 item_key；拿不到 item_key 就先用 search_library 语义检索。
- 检索结果超过 800 字的部分会被截断，需要完整内容时调用 get_chunk。

## 解析约定
- 任何 PDF 入库必须走 index_paper（内部使用 MinerU）。不提供其它解析方式。
- index_paper 失败时，如实回报失败原因，不得用其它来源拼凑内容。

## 边界
- 不回答与检索结果无关的推断性问题。
- 不执行任何写操作。
```

### 5.6 模式 B 适配器契约

```python
# core/harness.py
@dataclass
class HarnessSpec:
    name: str            # "claude" | "codex"
    argv: list[str]      # 例：["claude", "-p", "--output-format", "stream-json"]
    stdin_prompt: bool   # True = 任务书从 stdin 传入

def run(spec, task_brief, out_dir, timeout_s=600) -> Iterator[str]
```

- 任务书模板（`core/harness.py` 内常量）：

```
任务：{task}
涉及文献：{item_keys 或 无}
约束：
1. 解析 PDF 必须使用本机 mineru skill，不得使用其它解析器。
2. 结果写入 {out_dir}\{timestamp}.md，使用中文 Markdown。
3. 不改动 Zotero 库内任何条目。
```

- 子进程 `stdout` 按行读取 → `delta` 事件；`stderr` 汇总后随 `error` 事件返回。
- 客户端断开 → 终止子进程；超时 → 终止并返回 `error`。
- 退出码 0 且产出文件存在 → 追加 `final` 事件，`answer` 为产出文件路径。

---

## 6. 分阶段执行

### Phase 0 · 清空与骨架（0.5 天）

**任务**
1. 删除旧实现：`git rm -r backend frontend plugin mcp_server patches typings docs`；再删除根目录残留的旧插件工具链文件：`package.json package-lock.json tsconfig.json eslint.config.js postcss.config.js tailwind.config.js vitest.config.ts zotero-plugin.config.ts update.json AGENTS.md GIT_WORKFLOW.md PROJECT_REQUIREMENTS.md debug.png icon.svg`。保留 `LICENSE` 与 `icon.png`（新插件图标用）。
2. 重写 `.gitignore`，逐字包含：

```
node_modules/
dist/
build/
*.xpi
__pycache__/
*.pyc
.venv/
.env
/app/data/
/app/eval/reports/
```

> `/app/data/` 必须以 `/` 开头锚定根目录。写成裸 `data/` 会连带忽略 `app/data` 所在目录中的源码，历史故障即由此产生。

3. 建 `app/` 与 `dsh-plugin/` 目录树（§4），空文件先落位。
4. `app/pyproject.toml` 依赖：`fastapi uvicorn[standard] httpx pydantic-settings loguru
   chromadb sentence-transformers numpy`；开发依赖 `pytest pytest-asyncio ruff`。
5. `app/.env.example` 字段见 §2 与下表，一字不差：

```
ZOTEROSEEK_PORT=20801
ZOTEROSEEK_ZOTERO_API=http://127.0.0.1:23119/api/users/0
ZOTEROSEEK_ZOTERO_STORAGE=
ZOTEROSEEK_MINERU_TOKEN=
ZOTEROSEEK_MINERU_BASE=https://mineru.net/api/v4
ZOTEROSEEK_LLM_BASE=
ZOTEROSEEK_LLM_KEY=
ZOTEROSEEK_LLM_MODEL=
ZOTEROSEEK_EMBED_MODEL=BAAI/bge-m3
ZOTEROSEEK_RERANK_MODEL=BAAI/bge-reranker-base
ZOTEROSEEK_OUT_DIR=
```

**验收**
```powershell
cd E:\TheCode\ZoteroSeek
git status --short                                        # 只剩预期改动
uv run python -c "import fastapi, chromadb, sentence_transformers"   # 无报错
Get-Content .gitignore | Select-String '/app/data/'
```

---

### Phase 1 · 数据链路（1.5 天）

**任务**
1. `core/config.py`：pydantic-settings，`env_prefix="ZOTEROSEEK_"`，`env_file=".env"`。
2. `core/zotero.py`：按 `zotero` skill 文档实现 `list_items()`、`get_item(key)`、`attachment_path(key)`；`ZOTEROSEEK_ZOTERO_STORAGE` 为空时按 skill 文档的方式自动探测。
3. `core/mineru.py`：按 `mineru` skill 文档实现四步：创建任务 → 上传文件 → 轮询状态 → 下载解析结果（Markdown）；失败重试 3 次、指数退避；解析结果落 `app/data/parsed/{item_key}.md`。
4. `core/chunker.py`：按 Markdown 标题层级切分；不切断表格（`|...|`）、公式（`$$...$$`）、代码块；`max_tokens=800`、`overlap_tokens=100`、`min_chunk_tokens=50`；产出 §5.1 的 `Chunk`。
5. `core/embed.py`：`sentence-transformers` 加载 `ZOTEROSEEK_EMBED_MODEL`，批量编码；首次下载若失败，设 `HF_ENDPOINT=https://hf-mirror.com` 后重试。
6. `core/store.py`：sqlite 三表 `items(key, title, year, creators, indexed, parsed_path)`、`chunks(chunk_id, item_key, section, text)`、`runs(id, question, answer, citations, usage, created_at)`；chroma collection `chunks` 存向量，metadata 带 `chunk_id/item_key/title/section`。
7. `server/routes/library.py`、`index.py`；`server/main.py` 装配。

**验收**
```powershell
# 终端 A
uv run uvicorn app.server.main:app --port 20801

# 终端 B
Invoke-RestMethod http://127.0.0.1:20801/api/health
$body = @{ item_key = "<真实 item_key>" } | ConvertTo-Json
Invoke-RestMethod -Method Post http://127.0.0.1:20801/api/index -ContentType 'application/json' -Body $body
```
- 索引一篇 10 页论文，`chunks` 数量在 20–80 之间且无空 chunk
- `app/data/parsed/<key>.md` 存在，公式/表格未被切断（人工抽查 3 处）
- 重复索引同一篇不产生重复 chunk（先删后插）

---

### Phase 2 · 检索 + 重排（0.5 天）

**任务**
1. `core/retriever.py`：`dense_top20 = chroma.query(embed(query), n_results=20)` → `rerank.top8` → `SearchHit[]`；`item_key` 存在时用 chroma `where` 过滤。
2. `core/rerank.py`：`CrossEncoder(ZOTEROSEEK_RERANK_MODEL)`，`predict([(query, text), ...])`；模型加载失败时降级为纯 dense，并在返回体标注 `rerank=False`。
3. 单测：`test_retriever.py` 覆盖"有 item 过滤 / 无过滤 / rerank 关闭"三条路径。

**验收**
- 对 5 个手写查询，`SearchHit` 的 `section` 字段落在合理章节（人工判断）
- `pytest app/tests/test_retriever.py -q` 全绿

---

### Phase 3 · 模式 A 循环（1 天）

**任务**
1. `core/llm.py`：`httpx` 直连 `{base}/chat/completions`，支持 `tools` 与 `stream=True`；返回 `tool_calls` 完整列表；超时 90s。
2. `core/tools.py`：注册表 `{name: Tool(name, description, schema, handler)}`；handler 内先用 pydantic 校验参数，校验失败返回结构化文本 `{"error":"...","hint":"..."}` 作为工具结果（不抛异常）。
3. `core/prompt.py`：§5.5 原文常量。
4. `core/guards.py`：
   - `verify_citations(answer, allowed: set[str]) -> (ok, invalid_ns)`：解析 `[^N^]`，N 必须落在本轮检索结果序号内。
   - `budget`：`MAX_STEPS=6`、单步 90s、总 180s、token 上限 24000。
5. `core/loop.py`：按 §5.3 事件顺序产出；终止条件为「无 tool_calls」「步数用尽」「引用校验连续失败 2 次」；引用校验失败时把校验结论作为一轮纠正消息回填并重试一次，再失败则剥离非法引用标记并在 `final` 里加 `"citations_stripped": true`。
6. `server/routes/chat.py`：SSE 封装；`event: final` 后关闭流。

**验收**
```powershell
'{"question":"这篇论文用什么方法检测空洞？"}' | Set-Content -Path chat.json -Encoding utf8
curl.exe -N -X POST http://127.0.0.1:20801/api/chat -H "Content-Type: application/json" --data-binary "@chat.json"
```
- 5 个问题里有 ≥4 个答案带 `[^N^]`，且每个 N 都能对上 `retrieved` 事件里的 chunk
- 人为构造一次非法引用（临时改 prompt 让模型编一个 `[^9^]`），确认被 `guards` 拦下并触发一次纠正
- 请求一个知识库之外的问题，答案包含"文献库中没有相关内容"

---

### Phase 4 · 评测（1 天）

**任务**
1. `app/eval/qa_set.jsonl`：25 条，字段 `{"q","gold_chunk_id","item_key","type"}`，`type ∈ {fact, method, cross}`；从已索引文献中人工出题并标注 gold chunk（用 `chunks` 表查 chunk_id）。
2. `app/eval/run_eval.py`：
   - `recall_at_5 = 命中 gold_chunk_id 在 top5 的比例`
   - `citation_accuracy = 合法引用标记数 / 全部引用标记数`
   - `answer_rate = 有引用的回答数 / 总数`
   - 参数 `--rollout baseline|rerank`；`baseline` 强制关闭 rerank。
   - 产出 `app/eval/reports/{timestamp}-{rollout}.json` 与同名 `.md`（表格）。
3. `server/routes/eval.py` 调 `run_eval`。

**验收**
```powershell
uv run python -m app.eval.run_eval --rollout baseline
uv run python -m app.eval.run_eval --rollout rerank
```
- 两份报告均生成，含 `recall_at_5`、`citation_accuracy`、`answer_rate` 三个数
- `rerank` 与 `baseline` 的 `recall_at_5` 有可解释的差异（升或平，附在报告中）
- 报告中的数字来自同一次 `git rev-parse --short HEAD` 的代码与同一份 `qa_set.jsonl`

---

### Phase 5 · 模式 B（0.5 天）

**任务**
1. `core/harness.py`：按 §5.6 实现 `HarnessSpec` 与 `run()`；内置 `claude` 与 `codex` 两个 spec（`argv` 以本机 CLI 实测为准，先跑 `claude --help` / `codex --help` 确认非交互模式参数）。
2. `server/routes/deep.py`：`POST /api/deep` → SSE；子进程 stdout 行 → `delta`；结束 → `final`（含产出文件路径）。
3. 客户端断开与超时的处理：`try/finally` 确保子进程被 kill。

**验收**
- `curl -N -X POST /api/deep -d '{"task":"读一下第一篇文献的结论，写一个 200 字摘要"}'` 能在 120 秒内返回流式输出与产出文件路径
- 中途 `Ctrl+C` 断开后，任务管理器里无残留 CLI 子进程

---

### Phase 6 · DSH 插件（1.5 天）

**任务**
1. 先加载 `dsh-doc` skill，读 `references/host-plugin.md`、`references/ui-plugin.md`、`references/practices.md`、`references/verification.md`；按其中的模板生成 `dsh-plugin/`（manifest、`cordis.patch.yml`、locale、`docs/DETAIL.md`、`icon.svg`）。
2. Host 侧：注册 §5.4 四个工具。`search_library`/`get_chunk`/`index_paper` 直接转发 sidecar HTTP；`deep_research` 转发 `/api/deep` 并把 SSE 拼接成文本结果。
3. Client 侧：一个面板 slot，包含
   - 顶部：`文献库` / `深度模式` 切换
   - 左列：`GET /api/library` 列表，点击选中 `item_key`
   - 右侧：消息流（`react-markdown` 渲染）、输入框、发送按钮
   - 流式：`fetch` + `ReadableStream` 解析 SSE，逐 `delta` 追加
   - 引用：`[^N^]` 渲染为可点击脚注，点击滚动到对应片段
4. 用 `plugin_manager` 安装并启用该 bundle。

**验收**
- DSH Web GUI 中出现面板，能列出真实文献条目
- 面板内提一个问题，能看到 `step` → `retrieved` → `delta` → `final` 的完整过程，答案带可点击引用
- 在 DSH 的普通会话里说"查一下我文献库里关于 <主题> 的内容"，Agent 会调用 `search_library` 并引用返回结果
- 切换"深度模式"发起任务，能收到 CLI 的流式输出

---

### Phase 7 · 文档与收尾（0.5 天）

**任务**
1. `README.md`：项目一句话、架构图、两条启动命令、评测结果表（贴 Phase 4 的数字）。
2. `docs/ARCHITECTURE.md`：数据流、循环终止条件、引用校验规则、模式 B 契约。
3. 演示脚本 `scripts/demo.ps1`：启动 sidecar → 索引 3 篇 → 提 3 个问题 → 跑一次评测。

**验收**
- 全新终端按 README 执行两条命令可复现演示
- `git log --oneline` 每个 Phase 至少一个提交，信息格式 `phase N: <动词> <对象>`

---

## 7. 评测规范

| 指标 | 定义 | 口径 |
|---|---|---|
| `recall_at_5` | `gold_chunk_id` 出现在 top5 的题目数 / 25 | 检索侧，`top_k=5` 固定 |
| `citation_accuracy` | 合法引用标记数 / 全部引用标记数 | 生成侧，脚本判定，不靠模型自评 |
| `answer_rate` | 带 ≥1 个引用标记的回答数 / 25 | 生成侧 |

报告必须包含：`git rev-parse --short HEAD`、`qa_set.jsonl` 的 sha256、`rerank` 开关状态、两个 rollout 的对照表。

---

## 8. 最终验收清单

- [ ] `uv run uvicorn app.server.main:app --port 20801` 一次启动成功
- [ ] 25 条评测集跑通，报告落盘，三个指标有数值
- [ ] 5 个真实问题全部得到带可点击引用的回答
- [ ] 知识库外问题返回"文献库中没有相关内容"而非编造
- [ ] 模式 B 能拉起 CLI 并流式回显，中断无残留进程
- [ ] DSH 面板可用，普通会话中 Agent 能调用 `search_library`
- [ ] `pytest app/tests -q` 全绿
- [ ] `git status` 干净

---

## 9. 边界（不得越界的功能）

- 不支持非 PDF 附件
- 不支持扫描件 OCR 之外的版面重建（MinerU 输出什么就是什么）
- 不做跨库检索（只读本机 Zotero 库）
- 不做答案缓存
- 不做多语言（提示词固定中文作答）

---

## 10. 风险与回退

| 风险 | 现象 | 回退 |
|---|---|---|
| MinerU 接口变更 | 上传/轮询 4xx | 以 `mineru` skill 文档为准修正端点；仍失败则该文献标记 `parse_failed` 并回报用户 |
| 模型权重下载失败 | `sentence-transformers` 卡在下载 | 设 `HF_ENDPOINT=https://hf-mirror.com`；仍失败则换 `BAAI/bge-small-zh-v1.5` 并在报告注明 |
| LLM 不支持 `tools` | 返回 400 | 换支持 function calling 的模型；不得改为正则解析自由文本 |
| DSH 插件 API 变更 | 插件加载失败 | 以 `dsh-doc` skill 的当前模板为准重生成 manifest |
| 引用校验误杀 | 正常答案被判非法 | 只校验 `[^N^]` 形式的标记，忽略普通方括号；校验失败先重试一次再剥离 |

---

## 11. 提交粒度

| 提交 | 内容 |
|---|---|
| `phase 0: reset repo and scaffold` | 删除旧目录、新骨架、`.gitignore`、`pyproject.toml` |
| `phase 1: zotero and mineru ingestion` | 配置、Zotero 客户端、MinerU、分块、存储、索引 API |
| `phase 2: retrieval with rerank` | 检索 + 重排 + 单测 |
| `phase 3: agent loop with citation guard` | LLM 客户端、工具注册表、循环、校验、chat SSE |
| `phase 4: eval harness and baseline report` | 评测集、脚本、两份报告 |
| `phase 5: deep mode via local cli` | 适配器、deep SSE |
| `phase 6: dsh plugin panel and tools` | 插件 manifest、host 工具、client 面板 |
| `phase 7: docs and demo` | README、架构文档、演示脚本 |
