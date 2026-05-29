# AGENTS.md - ZoteroSeek 项目知识库

**最后更新**: 2026-05-29
**项目**: ZoteroSeek - Local AI Research Assistant Runtime

---

## 项目概述

ZoteroSeek 是一个本地 AI 研究助手系统，以 Zotero 为文献入口，Python Backend 为核心 runtime，React 为独立 UI。支持 RAG 语义检索、研究型问答、引用返回。

**架构版本**: v2.0（架构冻结）
**当前阶段**: MVP 工程完成

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│  Zotero Plugin (极薄)  │  Browser (React UI)                │
└───────────┬─────────────┴──────────┬────────────────────────┘
            │ HTTP                   │ HTTP
            ▼                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Python Backend (FastAPI)                   │
│  API Layer → Core Layer (Pipeline + RAG) → Storage Layer     │
│  SQLite (metadata) + ChromaDB (vectors)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
ZoteroSeek/
├── backend/                    # Python Backend（核心 runtime）
│   ├── main.py                 # FastAPI 入口
│   ├── pyproject.toml          # 依赖声明
│   ├── api/                    # API 路由
│   │   ├── health.py           # GET /api/v1/health
│   │   ├── chat.py             # POST /api/v1/chat (SSE)
│   │   ├── index.py            # POST /api/v1/index
│   │   ├── search.py           # POST /api/v1/search
│   │   └── library.py          # GET /api/v1/library
│   ├── core/                   # 核心逻辑
│   │   ├── pipeline/           # Ingestion Pipeline
│   │   │   ├── interfaces.py   # PipelineContext, PipelineResult
│   │   │   ├── ingestion.py    # IngestionPipeline
│   │   │   ├── parser.py       # DocumentParser
│   │   │   └── chunker.py      # SemanticChunker
│   │   ├── rag/                # RAG 检索
│   │   │   ├── retriever.py    # Retriever
│   │   │   └── chat_integration.py
│   │   ├── llm/                # LLM 客户端
│   │   │   ├── client.py       # LLMClient (流式)
│   │   │   └── embeddings.py   # EmbeddingClient
│   │   └── prompts/            # Prompt 管理
│   │       └── registry.py     # PromptRegistry
│   ├── data/                   # 数据层
│   │   ├── db.py               # SQLite 连接
│   │   ├── models.py           # SQLAlchemy 模型
│   │   ├── vector_store.py     # VectorStore ABC
│   │   └── chroma_store.py     # ChromaDB 实现
│   ├── extractors/             # 提取器
│   │   ├── base.py             # Extractor ABC
│   │   └── pdf.py              # PDFExtractor (PyMuPDF)
│   ├── models/                 # Pydantic 模型
│   │   ├── document.py         # CanonicalDocument
│   │   └── chunk.py            # Chunk, ChunkMetadata
│   ├── config/                 # 配置
│   │   └── settings.py         # Pydantic Settings
│   └── static/                 # React 构建输出
│
├── frontend/                   # React Frontend (Vite)
│   ├── src/
│   │   ├── api/client.ts       # API 客户端
│   │   ├── views/              # Chat, Library, Search
│   │   ├── stores/             # Zustand
│   │   └── components/
│   └── build → backend/static  # 构建输出
│
├── plugin/                     # Zotero 插件（极薄桥接层）
│   ├── manifest.json
│   ├── bootstrap.js
│   └── src/
│       ├── launcher.ts         # 启动后端 + 打开浏览器
│       └── bridge.ts           # HTTP 客户端
│
└── .venv/                      # Python 虚拟环境
```

---

## 开发命令

### Backend
```bash
# 安装依赖
cd backend && uv sync

# 启动后端
uv run python -m backend.main
# 访问: http://localhost:20801

# 验证导入
uv run python -c "from backend.main import app; print('OK')"
```

### Frontend
```bash
cd frontend
npm install
npm run dev      # 开发模式
npm run build    # 构建到 backend/static/
```

### Zotero 插件
```bash
cd plugin
npm run build    # 构建 .xpi
```

---

## 技术栈

| 层 | 技术 |
|---|------|
| Backend | FastAPI + Uvicorn + Pydantic |
| Database | SQLite (SQLAlchemy) + ChromaDB |
| PDF | PyMuPDF |
| Embedding | OpenAI Compatible API |
| LLM | OpenAI Compatible API (流式) |
| Frontend | React 18 + Vite + Tailwind CSS + Zustand |
| Plugin | TypeScript + zotero-plugin-scaffold |
| Logging | loguru |

---

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/health` | GET | 健康检查 |
| `/api/v1/index` | POST | 索引 PDF |
| `/api/v1/search` | POST | 语义搜索 |
| `/api/v1/chat` | POST | RAG 对话 (SSE) |
| `/api/v1/library` | GET | 已索引文献列表 |

---

## 关键约定

### Python Backend
- 使用 `loguru` 而非 `print`
- 使用 `Pydantic` 进行数据校验
- 使用 `SQLAlchemy` ORM
- API 版本前缀: `/api/v1/`

### React Frontend
- 使用 `@/` 路径别名
- Zustand 状态管理
- Tailwind CSS 样式

### Zotero 插件
- 不能使用 `console`（用 `Zotero.log()`）
- 不能使用 `localStorage`（用 `Zotero.Prefs`）
- manifest.json 必须包含 `strict_max_version`

---

## ⚠️ 环境约束（Agent 必读 — 最强约束）

### 环境管理
- **Python 环境使用 uv 管理**，不要用 pip 或 venv
- 安装依赖：`cd backend && uv sync`
- 运行命令：`uv run python -m backend.main`
- 验证导入：`uv run python -c "from backend.main import app; print('OK')"`

### 交互约束
- **同一时间只能调用一次 question tool**，但一次调用中可以同时提出多个问题
- 不要连续多次调用 question tool 询问不同问题，合并到一次调用中

### 禁止操作
- 不要修改 `.venv/` 目录
- 不要修改 `.scaffold/` 目录
- 不要删除 `data/` 下的数据文件
- 不要修改 `.reference-*/` 参考项目目录

## 环境要求

- Python 3.10+
- Node.js 18+
- Zotero 9.0+

### 环境变量
```bash
ZOTEROSEEK_LLM_API_KEY=your-api-key
ZOTEROSEEK_EMBEDDING_API_KEY=your-api-key
ZOTEROSEEK_PORT=20801
```

---

## 更新日志

### 2026-05-29
- 完成 MVP 架构重构
- 创建 Python FastAPI Backend
- 创建 React Frontend (Vite)
- 创建 Zotero 插件（极薄桥接层）
- 实现 Ingestion Pipeline (Extract → Parse → Chunk → Embed → Store)
- 实现 RAG 检索 + 流式对话
- 实现 CanonicalDocument Schema
- 实现 SemanticChunker
- 实现 PromptRegistry

### 2026-05-27
- 深色/浅色模式切换（9 个组件）
- Icon 组件主题适配
- 欢迎页间距优化
- toolbar icon 替换为 48x48

### 2026-05-24
- 更新目录结构
- 补全缺失文件

### 2026-05-21
- 实现 LLM 适配器层
- 实现 Zustand 状态管理
- 实现流式对话功能
- 修复多个 Zotero 9 兼容性问题

---

## 目录结构

```
ZoteroSeek/
├── addon/                  # Zotero 插件资源（manifest、bootstrap、locale、icons）
│   ├── manifest.json       # 插件清单（必须包含 strict_min_version 和 strict_max_version）
│   ├── bootstrap.js        # 插件入口（调用 hooks）
│   └── chrome/             # Chrome 内容（locale、icons）
├── src/
│   ├── __tests__/          # 测试文件（Vitest）
│   ├── addon.ts            # Addon 类（插件实例）
│   ├── addonHooks.ts       # 生命周期 hooks（onStartup、onMainWindowLoad 等）
│   ├── apis/               # 外部 API 调用
│   │   ├── llm/            # LLM 适配器（OpenAI、Anthropic、embeddings）
│   │   └── zotero/         # Zotero API 封装
│   ├── components/         # React 组件
│   │   ├── chat/           # 对话界面组件（ChatPanel、ConversationList、MessageList、InputBox）
│   │   ├── knowledge/      # 知识库组件（KnowledgePanel）
│   │   ├── pdf-chat/       # PDF 聊天组件（PdfChatPanel）
│   │   ├── settings/       # 设置界面组件（SettingsPanel）
│   │   ├── ErrorBoundary.tsx
│   │   └── Header.tsx
│   ├── hooks/              # React Hooks（useChat、useDragging、useCrossWindowChat）
│   ├── modules/            # 功能模块（menu、shortcut、preferences、pdfChatWindow）
│   ├── services/           # 业务逻辑
│   │   ├── agent/          # 已移除
│   │   ├── memory/         # 已移除
│   │   ├── pdf/            # PDF 文本提取（extractor）
│   │   └── rag/            # 知识库 RAG（indexer、retriever、chatIntegration）
│   ├── stores/             # Zustand 状态管理
│   │   ├── chatStore.ts    # 对话状态管理（Dexie 持久化）
│   │   ├── modelStore.ts   # 模型状态管理（Zotero.Prefs 持久化）
│   │   └── ragStore.ts     # 知识库状态管理
│   ├── typings/            # TypeScript 类型定义
│   ├── utils/              # 工具函数
│   │   ├── logger.ts       # 日志系统（使用 Zotero.log，不是 console）
│   │   ├── locale.ts       # 国际化
│   │   ├── prefs.ts        # Zotero.Prefs 封装
│   │   └── http.ts         # HTTP 工具
│   └── views/              # 视图层
│       ├── Container.tsx   # 主容器
│       ├── PdfChatApp.tsx  # PDF 聊天独立窗口
│       └── styles/         # 全局样式（globals.css）
├── zotero-plugin.config.ts # zotero-plugin-scaffold 配置
├── scripts/                # 构建脚本
└── typings/                # 全局类型声明（自动生成）
```

---

## 开发命令

```bash
npm install --legacy-peer-deps   # 安装依赖
npm start                        # 启动开发模式
npm run build                    # 构建插件
npm run test                     # 运行测试
npm run lint                     # ESLint 检查
npm run typecheck                # TypeScript 类型检查
npm run format                   # Prettier 格式化
```

---

## 关键约定

### 命名规范
- 组件文件：PascalCase（`ChatPanel.tsx`）
- Hook 文件：camelCase，use 前缀（`useChat.ts`）
- 工具函数文件：camelCase（`locale.ts`）
- 类型定义文件：`index.ts` 或 `global.d.ts`

### 导入顺序
1. React 相关
2. 第三方库
3. 项目模块（使用 `@/` 别名）
4. 样式文件

### Zotero 全局变量
项目使用 Zotero 插件特有的全局变量，在 `src/typings/global.d.ts` 中声明：
- `Zotero` - Zotero 主对象
- `ztoolkit` - 插件工具库
- `Zotero_Tabs` - 标签页管理
- `addon` - 插件实例
- `_globalThis` - 全局 this

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 样式 | Tailwind CSS |
| 状态管理 | Zustand |
| 本地存储 | Dexie (IndexedDB) |
| LLM 集成 | OpenAI 兼容接口 + Anthropic |
| 构建工具 | esbuild + zotero-plugin-scaffold |
| 测试框架 | Vitest |

---

## ⚠️ 关键注意事项（Zotero 插件开发）

### 必须遵守的规则

1. **不能使用 `console`**：Zotero 插件环境中 `console` 未定义，必须使用 `Zotero.log()` 或 `ztoolkit.log()`
2. **不能使用 `localStorage`**：Zotero 不支持，必须使用 `Zotero.Prefs`
3. **manifest.json 必须包含 `strict_max_version`**：否则 Zotero 会拒绝安装
4. **入口文件结构**：必须使用 `addon.ts` + `addonHooks.ts` 模式，bootstrap.js 调用 `Zotero.ZoteroSeek.hooks.onStartup()`
5. **构建配置**：必须有 `zotero-plugin.config.ts`，设置 `source: ["src", "addon"]`

### 已解决的关键问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 插件安装失败（版本不兼容） | manifest.json 缺少 `strict_max_version` | 添加 `"strict_max_version": "9.*"` |
| 插件加载失败（ReferenceError） | 使用了 `console.log` | 改用 `Zotero.log()` |
| 插件 UI 不显示 | 入口文件结构错误 | 创建 `addon.ts` + `addonHooks.ts` |
| ESLint 报错（no-undef） | Zotero 全局变量未声明 | 在 eslint.config.js 中添加 globals |
| React 错误 #299 | 组件未正确挂载 | 修复 onMainWindowLoad 中的渲染逻辑 |
| **TypeError: toLowerCase 错误** | `ztoolkit.Menu.register()` 缺少 `tag: "menuitem"` | 添加 `tag: "menuitem"` 属性 |
| **Locale 字符串显示为 key** | FTL 文件格式错误（使用了点号） | FTL key 使用连字符，如 `menu-tools` |
| **ztoolkit.Shortcut 未定义** | API 名称错误 | 改用 `ztoolkit.Keyboard.register()` |
| **Zotero.__addonInstance__ 未设置** | bootstrap.js hooks 未调用 | 在 addon.ts 中设置 `Zotero.__addonInstance__ = addon` |
| **Cu.unload 不是函数** | Zotero 9 废弃了 Cu.unload | 添加兼容性检查 |
| **onMainWindowLoad 未调用** | Zotero 不自动调用 | 在 onStartup 中手动调用 |
| **React 阻塞主线程导致卡死** | React + Zustand + Dexie 太重 | 采用混合 UI 方案 |

### 调试方法

1. **创建独立 Profile**：`zotero.exe -P` → 创建新 Profile → 修改数据目录
2. **查看日志**：工具 → 开发者 → 错误控制台
3. **过滤日志**：搜索 `[ZoteroSeek]` 前缀
4. **检查插件加载**：`extensions =>` 后面应该显示 ZoteroSeek

---

## Git 工作流

- 主分支：`main`
- 功能分支：`feature/*`
- 修复分支：`bugfix/*`
- 提交规范：Conventional Commits（`feat:`、`fix:`、`docs:` 等）

---

## 开发进度

### 已完成
- [x] 项目脚手架搭建
- [x] 基础配置（TypeScript、ESLint、Tailwind CSS）
- [x] CI/CD 流水线（GitHub Actions）
- [x] 中英文 README 文档
- [x] LLM 适配器层（OpenAI + Anthropic）
- [x] Zustand 状态管理（chatStore + modelStore）
- [x] 流式对话功能（token-by-token）
- [x] 多会话管理（列表、切换、重命名、删除）
- [x] 设置界面（API Key、模型、Base URL）
- [x] 错误处理和边界情况
- [x] 日志系统（Zotero.log）
- [x] 单元测试（101 tests, 8 files）
- [x] Zotero 9 兼容性修复
- [x] React UI 自动启动显示（onStartup 调用 showPanel）
- [x] 设置面板修复（原生偏好 + React saved-config CRUD）
- [x] PDF 聊天基础设施（独立窗口 + 文本提取 + PdfChatPanel）
- [x] 知识库 RAG（全库索引 + 语义搜索 + 对话集成）
- [x] Zotero 9 沙盒兼容性（见下方新增章节）
- [x] 深色/浅色模式切换（9 个组件 + Tailwind darkMode + ThemeProvider DOM 注入）
- [x] Icon 组件主题适配（dark prop + CSS invert filter）
- [x] 欢迎页间距优化（pt-12 → pt-4）
- [x] toolbar icon.png 替换为 48x48 正式图标
- [x] Python FastAPI Backend 骨架
- [x] Ingestion Pipeline (Extract → Parse → Chunk → Embed → Store)
- [x] CanonicalDocument Schema
- [x] SemanticChunker
- [x] ChromaDB 向量存储
- [x] RAG 语义检索
- [x] 流式对话 (SSE)
- [x] PromptRegistry
- [x] React Frontend (Vite + Tailwind + Zustand)
- [x] Zotero 插件（极薄桥接层）

### 待修复（Bug）
- [ ] toolbar icon 在 Zotero 主界面显示为方形（需要圆角或透明背景处理）
- [ ] React 面板渲染后内容区显示异常（仅 Header 可见）

### 待优化
- [ ] IndexedDB 不可用时的持久化方案（目前内存存储，重启丢失对话）
- [ ] PDF 聊天窗口在 Zotero 9 中的实际测试
- [ ] 知识库全库索引在 Zotero 9 中的实际测试

---

## 用户偏好

### 语言
- 主要语言：中文
- 代码注释：中文
- 提交信息：英文（Conventional Commits）

### 开发风格
- 使用函数式组件
- 使用 React Hooks
- 使用 Tailwind CSS
- 使用 TypeScript 严格模式

### 工具偏好
- 包管理器：npm
- 版本控制：Git
- 编辑器：VS Code
- 终端：PowerShell

---

## 常见问题

### Q: 为什么使用 --legacy-peer-deps？
A: ESLint 9 与某些插件存在 peer dependency 冲突，使用此参数跳过检查。

### Q: 构建输出在哪里？
A: `.scaffold/build/` 目录，不是 `build/`。

### Q: typings/ 目录是什么？
A: zotero-plugin-scaffold 自动生成的类型声明，已排除在检查之外。

### Q: 为什么不能使用 console？
A: Zotero 插件运行在特权环境中，`console` 未定义。必须使用 `Zotero.log()` 或 `ztoolkit.log()`。

### Q: 如何调试插件？
A: 创建独立 Profile（`zotero.exe -P`），查看错误控制台，过滤 `[ZoteroSeek]` 前缀。

---

## 更新日志

### 2026-05-29
- 完成 MVP 架构重构
- 创建 Python FastAPI Backend
- 创建 React Frontend (Vite)
- 创建 Zotero 插件（极薄桥接层）
- 实现 Ingestion Pipeline
- 实现 RAG 检索 + 流式对话
- 实现 CanonicalDocument Schema
- 实现 SemanticChunker
- 实现 PromptRegistry

### 2026-05-24
- 更新 AGENTS.md 目录结构（补全 knowledge、pdf-chat、rag、pdf 等目录）
- 标记 agent/ 和 memory/ 为已移除
- 更新单元测试数量（101 tests, 8 files）
- 补全缺失文件：useCrossWindowChat、ragStore、PdfChatApp、pdfChatWindow、embeddings

### 2026-05-21
- 实现 LLM 适配器层（OpenAI + Anthropic）
- 实现 Zustand 状态管理（chatStore + modelStore）
- 实现流式对话功能
- 实现多会话管理
- 实现设置界面
- 添加日志系统
- 添加单元测试（67 个）
- 修复 Zotero 9 兼容性问题（strict_max_version）
- 修复 console 未定义问题
- 重构入口文件结构（addon.ts + addonHooks.ts）
- 更新 ESLint 配置支持 Zotero 全局变量
- **修复菜单注册问题**（添加 `tag: "menuitem"`）
- **修复 Locale 系统**（从 DTD 迁移到 Fluent API）
- **修复快捷键注册**（使用 `ztoolkit.Keyboard` 替代 `ztoolkit.Shortcut`）
- **修复 bootstrap.js hooks 调用**（设置 `Zotero.__addonInstance__`）
- **修复 Cu.unload 兼容性**（Zotero 9 废弃）
- **修复 React 阻塞主线程**（采用混合 UI 方案）

### 2026-05-20
- 初始化项目脚手架
- 配置 CI/CD 流水线
- 添加中英文 README
- 创建 AGENTS.md 知识库
- 更新目录结构（新增 __tests__、settings、stores 细节）
- 添加 Vitest 测试框架到技术栈
- 添加 npm run test 命令
- 更新开发进度（基础对话功能已完成）

---

## 🔑 关键教训（Zotero 插件开发）

### 1. Zotero 9 API 变化
- **`ztoolkit.Shortcut` 不存在**：必须使用 `ztoolkit.Keyboard.register()`
- **`Cu.unload` 已废弃**：需要添加兼容性检查
- **Locale 使用 Fluent 格式**：不是 DTD，key 不能包含点号

### 2. bootstrap.js 生命周期
- **`onMainWindowLoad` 不一定被调用**：Zotero 可能不自动调用此钩子
- **解决方案**：在 `onStartup` 中手动创建 UI
- **必须设置 `Zotero.__addonInstance__`**：否则 bootstrap.js 无法调用 hooks

### 3. React 性能问题
- **React + Zustand + Dexie 太重**：会阻塞主线程导致 Zotero 卡死
- **解决方案**：采用混合 UI 方案
  - 先显示轻量级原生 JS UI
  - 后台异步加载 React 应用
  - React 加载完成后替换轻量级 UI

### 4. 菜单注册格式
```typescript
// ❌ 错误：缺少 tag 属性
ztoolkit.Menu.register('menuTools', {
  id: '...',
  label: '...',
});

// ✅ 正确：必须包含 tag: "menuitem"
ztoolkit.Menu.register('menuTools', {
  tag: "menuitem",
  id: '...',
  label: '...',
});
```

### 5. FTL 文件格式
```ftl
# ❌ 错误：key 中不能使用点号
zoteroseek-menu.tools = ZoteroSeek AI Assistant

# ✅ 正确：使用连字符
menu-tools = ZoteroSeek AI Assistant
```

### 6. 快捷键注册格式
```typescript
// ❌ 错误：ztoolkit.Shortcut 不存在
ztoolkit.Shortcut.register('event', { ... });

// ✅ 正确：使用 ztoolkit.Keyboard
ztoolkit.Keyboard.register((ev, data) => {
  if (data.type === 'keyup' && data.keyboard) {
    if (data.keyboard.equals('accel,shift,s')) {
      // 处理快捷键
    }
  }
});
```

### 7. Zotero 9 沙盒全局 API 兼容性

Zotero 9 的 privileged context 是一个受限的 JavaScript 环境，以下浏览器全局 API **不可用**：

| API | 状态 | 解决方案 |
|-----|------|----------|
| `IndexedDB` | ❌ 不可用 | chatStore/ragStore 自动 fallback 到内存 Map |
| `setTimeout` | ❌ 未绑定 Window | `win.setTimeout.bind(win)` 同时 patch `globalThis` 和 `_globalThis` |
| `setInterval` | ❌ 同上 | 同上 |
| `clearTimeout` | ❌ 同上 | 同上 |
| `clearInterval` | ❌ 同上 | 同上 |
| `navigator` | ❌ 未定义 | polyfill: `{ onLine: true, userAgent: 'Zotero/9.0' }` |
| `structuredClone` | ❌ 未定义 | polyfill: `JSON.parse(JSON.stringify(obj))` |
| `console` | ❌ 未定义 | 使用 `Zotero.log()` |
| `localStorage` | ❌ 不存在 | 使用 `Zotero.Prefs` |

**关键原则**：
- `_globalThis` 是 bootstrap.js 注入的 context 对象，**不等于** `globalThis`
- React 的 `import()` 动态加载使用 `globalThis` 作用域，所以 polyfill 必须同时 patch 两者
- Dexie 构造函数**不**立即检查 IndexedDB，错误在第一次数据库操作时抛出 → 需要 `typeof indexedDB` 预检
- `window.openDialog()` 需要 `(window as any)` 类型断言（Mozilla 专有 API）

### 8. preferences.xhtml 脚本加载

- `Zotero.PreferencePanes.register()` 的 `scripts` 参数在 Zotero 9 中不可靠
- 替代方案：在 `.xhtml` 中使用 `<html:script src="chrome://..."/>` **自闭合标签**（Zotero 9 支持）
- **不要**使用显式闭合 `</html:script>`——会导致脚本不被加载
- `data-l10n-id` 在 preferences pane context 中不可用（Fluent 未初始化）→ 使用硬编码文本
- `registerPrefs()` 中 label 硬编码为 `'ZoteroSeek'`，因为 `getString()` 在 Fluent 初始化前运行

---

## ⚠️ 开发约束（Agent 必读 — 最强约束）

### 环境管理
- **Python 环境使用 uv 管理**，不要用 pip 或 venv
- 安装依赖：`cd backend && uv sync`
- 运行命令：`uv run python -m backend.main`
- 验证导入：`uv run python -c "from backend.main import app; print('OK')"`

### 交互约束
- **同一时间只能调用一次 question tool**，但一次调用中可以同时提出多个问题
- 不要连续多次调用 question tool 询问不同问题，合并到一次调用中

### 禁止操作
- 不要修改 `.venv/` 目录
- 不要修改 `.scaffold/` 目录
- 不要删除 `data/` 下的数据文件
- 不要修改 `.reference-*/` 参考项目目录
