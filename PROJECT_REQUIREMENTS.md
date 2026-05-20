# ZoteroSeek - 项目需求文档

> Zotero 智能研究助手 - 基于大语言模型的文献管理与知识检索插件

## 1. 项目概述

### 1.1 项目定位

ZoteroSeek 是一个专为 Zotero 设计的 AI 智能体插件，旨在通过大语言模型（LLM）技术提升学术研究效率。它不仅是一个对话工具，更是一个具备记忆、检索和自主执行能力的智能研究助手。

### 1.2 核心价值

- **智能对话**：与文献进行自然语言交互，快速获取信息
- **知识检索**：基于语义的智能检索，超越传统关键词搜索
- **研究辅助**：自动总结、翻译、分析文献，提升研究效率
- **知识积累**：构建个人知识库，实现知识的持久化和复用

### 1.3 目标用户

- 科研人员、研究生、博士生
- 需要大量阅读和管理学术文献的研究者
- 希望利用 AI 技术提升研究效率的学者

---

## 2. 技术架构

### 2.1 技术栈

```
前端框架:    React 18 + TypeScript
样式方案:    Tailwind CSS + CSS Modules
状态管理:    Zustand
本地存储:    Dexie (IndexedDB 封装)
构建工具:    esbuild + zotero-plugin-scaffold
LLM 抽象层:  自定义 Adapter 模式
RAG 方案:    LangChain.js + ChromaDB
Markdown:    react-markdown + remark-gfm
```

### 2.2 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      Zotero Plugin (xpi)                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                React UI Layer                        │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │   │
│  │  │ ChatPanel│ │ History  │ │ Settings │ │Knowledge│ │   │
│  │  │ 对话面板  │ │ 历史面板  │ │ 设置面板  │ │知识库面板│ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↕                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              State Management (Zustand)              │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │chatStore │ │modelStore│ │knowledge │            │   │
│  │  │对话状态   │ │模型配置   │ │知识库状态 │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↕                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              LLM Adapter Layer                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ OpenAI   │ │ DeepSeek │ │   MiMo   │ ...        │   │
│  │  │ Adapter  │ │ Adapter  │ │ Adapter  │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↕                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              RAG & Memory Layer                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │VectorStore│ │  Graph   │ │Conversa- │            │   │
│  │  │ ChromaDB │ │   RAG    │ │tionMemory│            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↕                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Zotero Integration Layer                │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ ItemAPI  │ │ NoteAPI  │ │PDFReader │            │   │
│  │  │ 条目操作  │ │ 笔记操作  │ │ PDF解析  │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 目录结构

```
ZoteroSeek/
├── .github/
│   └── workflows/
│       ├── build.yml          # CI 构建
│       └── release.yml        # 自动发布
├── addon/                     # Zotero 插件静态资源
│   ├── chrome/
│   │   ├── content/
│   │   │   ├── icons/         # 图标资源
│   │   │   ├── locale/        # 国际化文件
│   │   │   └── zoteroseek.xhtml
│   │   └── manifest.json
│   ├── install.rdf
│   └── update.json
├── src/                       # 源代码
│   ├── apis/                  # 外部 API 调用
│   │   ├── llm/               # LLM 适配器
│   │   │   ├── adapter.ts     # 适配器接口
│   │   │   ├── openai.ts      # OpenAI 适配器
│   │   │   ├── deepseek.ts    # DeepSeek 适配器
│   │   │   └── mimo.ts        # MiMo 适配器
│   │   └── zotero/            # Zotero API 封装
│   │       ├── item.ts
│   │       ├── note.ts
│   │       └── search.ts
│   ├── components/            # React 组件
│   │   ├── chat/              # 对话相关组件
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageItem.tsx
│   │   │   └── InputBox.tsx
│   │   ├── history/           # 历史记录组件
│   │   │   ├── HistoryPanel.tsx
│   │   │   └── ConversationItem.tsx
│   │   ├── settings/          # 设置组件
│   │   │   └── SettingsPanel.tsx
│   │   ├── knowledge/         # 知识库组件
│   │   │   └── KnowledgePanel.tsx
│   │   └── common/            # 通用组件
│   │       ├── Button.tsx
│   │       ├── Modal.tsx
│   │       └── Loading.tsx
│   ├── hooks/                 # React Hooks
│   │   ├── useChat.ts
│   │   ├── useConversation.ts
│   │   ├── useKnowledge.ts
│   │   └── useSettings.ts
│   ├── stores/                # Zustand 状态管理
│   │   ├── chatStore.ts
│   │   ├── modelStore.ts
│   │   └── knowledgeStore.ts
│   ├── services/              # 业务逻辑服务
│   │   ├── rag/               # RAG 相关
│   │   │   ├── vectorStore.ts # 向量存储
│   │   │   ├── embedder.ts    # 文本嵌入
│   │   │   └── retriever.ts   # 检索器
│   │   ├── memory/            # 记忆系统
│   │   │   └── conversationMemory.ts
│   │   └── agent/             # 智能体逻辑
│   │       └── agent.ts
│   ├── utils/                 # 工具函数
│   │   ├── markdown.ts
│   │   ├── pdf.ts
│   │   └── storage.ts
│   ├── views/                 # 视图层
│   │   ├── Container.tsx      # 主容器
│   │   ├── Providers.tsx      # Context Providers
│   │   └── styles/
│   │       └── globals.css
│   ├── typings/               # TypeScript 类型定义
│   │   ├── llm.ts
│   │   ├── conversation.ts
│   │   └── knowledge.ts
│   ├── hooks.ts               # 插件生命周期
│   └── index.ts               # 入口文件
├── scripts/                   # 构建脚本
│   ├── build.mjs
│   └── start.mjs
├── tests/                     # 测试文件
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── README.md
```

---

## 3. 功能需求

### 3.1 MVP 功能（第一阶段）

#### 3.1.1 基础对话功能

**描述**：用户可以与 AI 进行自然语言对话，获取研究相关的帮助。

**功能点**：
- [ ] 多轮对话支持
- [ ] 流式响应（Streaming）
- [ ] Markdown 渲染（代码高亮、公式、表格）
- [ ] 消息复制、重新生成
- [ ] 停止生成

**技术要求**：
- 使用 React 组件实现对话界面
- 支持 SSE (Server-Sent Events) 流式传输
- 使用 react-markdown 渲染 Markdown

#### 3.1.2 对话历史管理

**描述**：用户可以管理多个对话会话，方便切换和搜索。

**功能点**：
- [ ] 创建新对话
- [ ] 对话列表展示
- [ ] 对话切换
- [ ] 对话重命名
- [ ] 对话删除
- [ ] 对话搜索（按标题、内容）
- [ ] 对话导出（Markdown、JSON）

**技术要求**：
- 使用 Dexie (IndexedDB) 持久化存储
- 支持对话标题自动生成（基于首条消息）

#### 3.1.3 多模型支持

**描述**：支持多个 LLM 提供商，用户可自由选择。

**功能点**：
- [ ] 统一的模型配置界面
- [ ] API Key 管理（加密存储）
- [ ] 模型切换（对话级别）
- [ ] 流式响应支持
- [ ] 错误处理和重试机制

**支持的模型**：
| 提供商 | 模型 | 特点 |
|--------|------|------|
| OpenAI | GPT-4o, GPT-4-turbo | 函数调用支持最好 |
| DeepSeek | DeepSeek-V3, DeepSeek-R1 | 性价比高，中文优秀 |
| MiMo | MiMo-v2-pro | 小米自研，国内访问快 |

**技术要求**：
- Adapter 模式设计，易于扩展新模型
- 统一的请求/响应格式
- 支持 OpenAI 兼容接口

#### 3.1.4 PDF 聊天

**描述**：基于当前阅读的 PDF 内容进行问答。

**功能点**：
- [ ] PDF 文本提取
- [ ] 当前 PDF 自动关联
- [ ] 基于 PDF 内容的问答
- [ ] PDF 段落定位（点击答案跳转到原文）

**技术要求**：
- 使用 pdf-parse 或 PDF.js 提取文本
- 文本分块（Chunking）策略
- 向量化存储和检索

#### 3.1.5 知识库管理

**描述**：将文献库向量化存储，实现跨文献语义检索。

**功能点**：
- [ ] 文献索引（单篇、批量）
- [ ] 向量存储管理
- [ ] 语义检索
- [ ] 检索结果展示
- [ ] 知识库统计

**技术要求**：
- ChromaDB 本地向量数据库
- 文本嵌入模型（OpenAI Embedding 或本地模型）
- 分块策略优化

#### 3.1.6 设置面板

**描述**：插件配置管理。

**功能点**：
- [ ] 模型配置（API Key、模型选择）
- [ ] 界面设置（主题、字体大小）
- [ ] RAG 配置（分块大小、检索数量）
- [ ] 数据管理（清除缓存、导出数据）

---

### 3.2 迭代功能（后续版本）

#### 3.2.1 智能体功能（v0.2.0）

- [ ] 工具调用（搜索、翻译、笔记生成）
- [ ] 记忆系统（短期记忆、长期记忆）
- [ ] 自主执行（多步骤任务）
- [ ] 提示词模板库

#### 3.2.2 GraphRAG 增强（v0.3.0）

- [ ] 知识图谱构建
- [ ] 实体关系提取
- [ ] 图谱增强检索
- [ ] 可视化展示

#### 3.2.3 协作功能（v0.4.0）

- [ ] 知识库共享
- [ ] 团队协作
- [ ] 云端同步

---

## 4. 非功能需求

### 4.1 性能要求

- 插件启动时间 < 2 秒
- 对话响应延迟 < 500ms（不含 LLM 处理时间）
- 知识库检索 < 1 秒
- 内存占用 < 200MB

### 4.2 兼容性要求

- Zotero 7.0+
- Windows / macOS / Linux
- 无外部依赖（纯浏览器环境）

### 4.3 安全要求

- API Key 加密存储
- 用户数据本地存储
- 无遥测数据收集

### 4.4 可维护性要求

- TypeScript 类型安全
- 单元测试覆盖率 > 60%
- 清晰的模块边界
- 完整的 API 文档

---

## 5. UI 设计规范

### 5.1 设计风格

采用现代渐变风格，参考 Aria 项目的设计语言：

- **背景**：渐变背景 `from-red-50 to-blue-50`
- **卡片**：白色背景，圆角 `rounded-xl`，柔和阴影
- **文字**：深灰色系 `text-gray-800`
- **强调色**：蓝色系 `blue-500`

### 5.2 布局规范

```
┌─────────────────────────────────────┐
│           Header (标题栏)            │
│  ┌─────────────────────────────┐   │
│  │      Conversation Tabs      │   │
│  │        (对话标签页)          │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  │      Message List           │   │
│  │        (消息列表)            │   │
│  │                             │   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │        Input Box            │   │
│  │        (输入框)              │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │      Status Bar             │   │
│  │      (状态栏)               │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 5.3 交互规范

- **拖拽**：主容器支持拖拽移动
- **缩放**：Ctrl + 滚轮缩放界面
- **快捷键**：
  - `Ctrl/Cmd + /`：打开/关闭插件
  - `Enter`：发送消息
  - `Shift + Enter`：换行
  - `Ctrl/Cmd + N`：新建对话
  - `Ctrl/Cmd + K`：搜索对话

---

## 6. 版本管理规范

### 6.1 版本号规则

采用语义化版本 (SemVer)：`MAJOR.MINOR.PATCH`

- **MAJOR**：不兼容的 API 修改
- **MINOR**：向下兼容的功能性新增
- **PATCH**：向下兼容的问题修正

示例：`0.1.0` → `0.1.1` → `0.2.0` → `1.0.0`

### 6.2 Git 分支策略

```
main (主分支)
  │
  ├── develop (开发分支)
  │     │
  │     ├── feature/xxx (功能分支)
  │     ├── bugfix/xxx (修复分支)
  │     └── ...
  │
  └── release/x.x.x (发布分支)
```

**分支说明**：
- `main`：稳定的生产版本，只接受 merge
- `develop`：开发主分支，功能分支合并到这里
- `feature/*`：功能开发分支，从 develop 分出
- `bugfix/*`：Bug 修复分支
- `release/*`：发布准备分支，用于最后测试和版本号更新

### 6.3 提交规范

采用 Conventional Commits 规范：

```
<type>(<scope>): <subject>

类型(type)：
- feat: 新功能
- fix: 修复 Bug
- docs: 文档更新
- style: 代码格式（不影响功能）
- refactor: 重构
- test: 测试相关
- chore: 构建/工具相关

示例：
feat(chat): 添加流式响应支持
fix(llm): 修复 OpenAI API 超时问题
docs(readme): 更新安装说明
```

### 6.4 发布流程

```mermaid
graph LR
    A[功能开发完成] --> B[合并到 develop]
    B --> C[创建 release 分支]
    C --> D[更新版本号]
    D --> E[测试验证]
    E --> F[合并到 main]
    F --> G[打 Git Tag]
    G --> H[GitHub Actions 自动构建]
    H --> I[发布 Release]
```

**GitHub Actions 配置**：

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build
      - uses: softprops/action-gh-release@v1
        with:
          files: build/*.xpi
```

---

## 7. 国际化规范

### 7.1 支持语言

- 简体中文 (zh-CN) - 默认
- English (en-US)

### 7.2 实现方案

使用自定义 i18n 方案，参考 Zotero 插件开发规范：

```typescript
// src/utils/locale.ts
export function getString(name: string, params?: string[]): string {
  // 从 Zotero 获取本地化字符串
  return Zotero.getString(`zoteroseek.${name}`, params);
}
```

### 7.3 翻译文件结构

```
addon/chrome/locale/
├── zh-CN/
│   └── zoteroseek.dtd
└── en-US/
    └── zoteroseek.dtd
```

---

## 8. 创新点与亮点（简历展示）

### 8.1 技术亮点

1. **LLM 智能体架构**
   - 设计统一的 LLM 适配器层，支持多模型无缝切换
   - 实现流式响应和函数调用机制
   - 构建对话记忆系统，支持上下文感知

2. **RAG 检索增强生成**
   - 使用 LangChain.js 构建完整的 RAG 流程
   - ChromaDB 本地向量数据库，保护用户隐私
   - 文档分块、嵌入、检索全链路优化

3. **React 组件化架构**
   - 现代 React 18 + TypeScript 技术栈
   - Zustand 状态管理，清晰的数据流
   - Tailwind CSS 高效样式开发

4. **Zotero 深度集成**
   - 直接操作 Zotero 数据库 API
   - PDF 内容提取和智能问答
   - 笔记自动生成和插入

### 8.2 可讲解的技术点

**面试场景 1：介绍一下这个项目？**

> ZoteroSeek 是一个基于大语言模型的 Zotero 智能研究助手插件。它采用 React + TypeScript 技术栈，通过 Adapter 模式支持多种 LLM（OpenAI、DeepSeek、MiMo），并使用 LangChain.js + ChromaDB 实现 RAG 检索增强生成。用户可以与文献进行自然语言对话，实现智能问答、知识检索等功能。

**面试场景 2：你是怎么设计多模型支持的？**

> 我采用了 Adapter 设计模式，定义了统一的 LLMAdapter 接口，每个模型提供商（OpenAI、DeepSeek等）实现这个接口。这样做的好处是：
> 1. 易于扩展：新增模型只需实现接口
> 2. 统一调用：上层代码无需关心具体模型
> 3. 可测试：可以 Mock 接口进行单元测试

**面试场景 3：RAG 是怎么实现的？**

> RAG 流程分为三个阶段：
> 1. **索引阶段**：将文献文本分块（Chunking），通过 Embedding 模型转换为向量，存储到 ChromaDB
> 2. **检索阶段**：用户提问时，将问题向量化，在 ChromaDB 中检索最相似的文档块
> 3. **生成阶段**：将检索到的文档块作为上下文，与用户问题一起发送给 LLM 生成答案

**面试场景 4：遇到了什么技术挑战？**

> 1. **流式响应**：需要处理 SSE 协议，实现打字机效果，同时处理中断和错误
> 2. **PDF 解析**：Zotero 插件环境限制，需要在浏览器端实现 PDF 文本提取
> 3. **性能优化**：大量文献向量化时的内存和速度优化，采用分批处理和增量索引策略

---

## 9. 开发计划

### 9.1 里程碑

| 版本 | 目标时间 | 主要功能 |
|------|----------|----------|
| v0.1.0 | +2 周 | 基础对话 + 历史管理 |
| v0.2.0 | +4 周 | PDF 聊天 + 多模型支持 |
| v0.3.0 | +6 周 | 知识库管理 + RAG |
| v0.4.0 | +8 周 | 智能体功能 |
| v1.0.0 | +12 周 | 正式发布版 |

### 9.2 任务分解

**Phase 1：基础对话（2 周）**
- [ ] 项目脚手架搭建
- [ ] React 基础组件开发
- [ ] OpenAI API 集成
- [ ] 流式响应实现
- [ ] 对话历史存储

**Phase 2：PDF 聊天（2 周）**
- [ ] PDF 文本提取
- [ ] 文档分块处理
- [ ] 向量化存储
- [ ] 语义检索实现

**Phase 3：知识库（2 周）**
- [ ] ChromaDB 集成
- [ ] 批量索引功能
- [ ] 知识库管理界面
- [ ] 检索优化

**Phase 4：完善与发布（2 周）**
- [ ] UI/UX 优化
- [ ] 测试覆盖
- [ ] 文档编写
- [ ] 发布准备

---

## 10. 附录

### 10.1 参考项目

| 项目 | 参考价值 |
|------|----------|
| [Aria](https://github.com/lifan0127/ai-research-assistant) | React 架构、UI 设计 |
| [Zotero-GPT](https://github.com/MuiseDestiny/zotero-gpt) | Zotero 集成、对话实现 |
| [PapersGPT](https://github.com/papersgpt/papersgpt-for-zotero) | 多模型支持 |

### 10.2 技术文档

- [Zotero 插件开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [React 官方文档](https://react.dev/)
- [LangChain.js 文档](https://js.langchain.com/)
- [ChromaDB 文档](https://docs.trychroma.com/)

### 10.3 术语表

| 术语 | 说明 |
|------|------|
| RAG | Retrieval-Augmented Generation，检索增强生成 |
| LLM | Large Language Model，大语言模型 |
| Embedding | 文本向量化，将文本转换为数值向量 |
| Chunking | 文档分块，将长文本分割为小段 |
| Streaming | 流式响应，逐步返回生成内容 |

---

**文档版本**：v1.0.0  
**最后更新**：2026-05-20  
**作者**：ZoteroSeek Team
