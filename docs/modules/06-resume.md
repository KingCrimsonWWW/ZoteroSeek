# 06 — 简历与面试准备

## 简历项目描述

### 中文版

> **ZoteroSeek — 基于 LangGraph Agent 的本地 AI 学术研究助手**
>
> 技术栈：Python / FastAPI / LangChain / LangGraph / ChromaDB / React / TypeScript / MinerU
>
> 设计并实现了基于 RAG + Agent 架构的本地 AI 研究助手，以 Zotero 文献库为数据源，支持学术论文的语义检索和智能问答。
>
> - **Agent 架构**：基于 LangGraph 构建 ReAct Agent，LLM 自主决定调用搜索/索引/查询工具，实现多步推理和工具编排
> - **RAG 检索增强**：Embedding 向量化 + ChromaDB 语义检索 + Prompt 工程，回答附带可验证引用，抑制 LLM 幻觉
> - **文档智能解析**：集成 MinerU 文档解析 API，实现异步任务编排（提交→上传→轮询→下载），支持结构化 Markdown 输出
> - **可插拔管线**：5 阶段处理管线（Extract→Parse→Chunk→Embed→Store），策略模式支持 MinerU / PyMuPDF 双引擎热切换
> - **全栈实现**：FastAPI 后端（SSE 流式）+ React 前端（Liquid Glass UI）+ Zotero 插件（极薄桥接层）

### 英文版

> **ZoteroSeek — Local AI Research Assistant with LangGraph Agent Architecture**
>
> Tech Stack: Python / FastAPI / LangChain / LangGraph / ChromaDB / React / TypeScript / MinerU
>
> Designed and implemented a local AI research assistant based on RAG + Agent architecture, using Zotero library as data source for semantic search and intelligent Q&A on academic papers.
>
> - **Agent Architecture**: Built ReAct Agent with LangGraph, enabling LLM to autonomously decide when to use search/index/query tools for multi-step reasoning
> - **RAG Pipeline**: Embedding vectorization + ChromaDB semantic search + Prompt engineering, with verifiable citations to mitigate LLM hallucination
> - **Document Parsing**: Integrated MinerU API with async task orchestration (submit→upload→poll→download), supporting structured Markdown output
> - **Pluggable Pipeline**: 5-stage pipeline (Extract→Parse→Chunk→Embed→Store) with Strategy pattern for MinerU/PyMuPDF hot-switching
> - **Full-stack**: FastAPI backend (SSE streaming) + React frontend (Liquid Glass UI) + Zotero plugin (thin bridge layer)

---

## 面试题准备

### Q1: 为什么用 RAG 而不是微调模型？

**A**: 四个原因：
1. **实时性**：新增论文立即可检索，无需重新训练（训练一次几万美元）
2. **可解释性**：回答附带 `[^N^]` 引用，用户可点击查看原文验证
3. **成本低**：只调 API，不需要 GPU 训练
4. **通用性**：换 Embedding 模型就能用，不绑定特定 LLM

### Q2: 为什么用 LangGraph 而不是手写 RAG？

**A**:
1. **自主决策**：Agent 自行判断是否需要检索（普通 RAG 每次都检索）
2. **工具编排**：LLM 可以在一个对话中组合使用多个工具（先查库→再搜索→再回答）
3. **可观测性**：LangGraph 提供 `astream_events` API，可以追踪每一步决策
4. **可扩展**：添加新工具只需一个 `@tool` 函数，不改 Agent 逻辑

### Q3: 什么是 ReAct 模式？

**A**: ReAct = Reasoning + Acting。LLM 在回答问题时经历一个循环：
1. **Thought**（思考）：分析问题，决定下一步行动
2. **Action**（行动）：调用工具（如搜索知识库）
3. **Observation**（观察）：获取工具返回的结果
4. **重复**直到 LLM 认为信息足够，给出最终 Answer

这比"每次都检索"的固定 RAG 更灵活 — 简单问题直接回答，复杂问题先搜索再回答。

### Q4: 如何处理 LLM 幻觉？

**A**: 三层防护：
1. **Prompt 约束**：系统提示词要求"只在有上下文时引用，无上下文时不要编造引用"
2. **RAG 检索**：Agent 先搜索知识库获取真实文献片段，再基于此回答
3. **引用溯源**：前端显示 Sources 面板，用户可点击查看原文验证

### Q5: SSE vs WebSocket 怎么选？

**A**:
- **SSE**：单向（服务端→客户端），基于 HTTP，适合"一问一答"。实现简单，天然支持 CORS 和代理
- **WebSocket**：双向通信，适合实时协作场景（如多人编辑）
- 聊天场景只需要服务端推送 token，SSE 足够，不需要 WebSocket 的额外复杂度

### Q6: ChromaDB vs FAISS vs Milvus？

**A**:
- **ChromaDB**：嵌入式，零配置，`pip install` 即用，支持 metadata 过滤。适合本地小规模（<10 万文档）
- **FAISS**：Facebook 的纯向量检索库，速度极快，但不支持 metadata 过滤和持久化
- **Milvus**：分布式向量数据库，需要 Docker 部署，适合生产环境大规模场景
- 我选 ChromaDB 因为：本地部署零配置，`PersistentClient` 自动持久化，支持按 `item_id` 过滤

### Q7: 如何保证检索质量？

**A**: 三层保障：
1. **MinerU 结构化解析**：ML 模型正确识别论文分段（Abstract/Methods/...），保留标题语义
2. **语义分块**：800 token + 100 overlap 确保上下文连贯，不在表格/公式中间断开
3. **分段元数据**：每个 chunk 带 `section_type`，搜索时可按分段类型加权

### Q8: 如何扩展到团队使用？

**A**:
1. 替换 ChromaDB → Milvus（支持分布式）
2. 替换 SQLite → PostgreSQL
3. 添加用户认证（JWT）
4. 前端独立部署，后端容器化（Docker）

### Q9: 如何给 Agent 添加新能力？

**A**: 只需 3 步：
```python
# 1. 定义工具
@tool
async def new_tool(param: str) -> str:
    """工具描述（LLM 根据这个描述决定何时调用）"""
    return result

# 2. 注册到 Agent
tools = [search_knowledge, query_library, index_document, new_tool]
agent = create_react_agent(llm, tools, prompt=...)

# 3. 完成 — LLM 自动学习何时使用新工具
```

### Q10: 前端流式渲染怎么实现？

**A**: "Placeholder-then-fill" 模式：
1. 用户发送消息后，立即添加一个空的 assistant 消息（显示 Thinking... 动画）
2. SSE 流到达时，逐 token 更新这个消息的内容
3. 用 `scrollIntoView` 自动滚动到底部
4. 流结束后附加 Sources 面板

---

## 项目亮点提炼（面试加分项）

### 1. Agent 架构（核心亮点）
- 不是简单的"调 API"，而是 LLM 自主规划 + 工具调用 + 多步执行
- LangGraph ReAct Agent，可扩展的工具系统

### 2. 全链路文档处理
- MinerU 异步 4 步编排（提交→上传→轮询→下载）
- Markdown 感知解析（不破坏表格/公式/代码块）
- 语义分块 + 重叠上下文保持

### 3. 工程质量
- 策略模式可插拔架构
- 27 个自动化测试（pytest）
- CI/CD 自动构建（GitHub Actions）
- Pydantic 类型校验 + 结构化日志

### 4. 全栈能力
- 后端：FastAPI + SSE 流式 + SQLAlchemy + ChromaDB
- 前端：React + Zustand + Tailwind + Liquid Glass UI
- 插件：Zotero 9 插件开发（XUL + bootstrap.js）

### 5. 实际可用
- 不是 demo，是真正可以使用的工具
- 已索引 11 篇学术论文，支持语义搜索和 RAG 问答
- 有 Zotero 插件，有 Web UI，有 API
