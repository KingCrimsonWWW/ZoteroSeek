# 03 — Agent 架构

> 本文档描述 ZoteroSeek 的 Agent 层设计——从"手写 RAG 流程"到"LangGraph ReAct Agent"的架构演进，以及背后的工程权衡。

---

## 目录

1. [什么是 Agent](#1-什么是-agent)
2. [LangChain 生态全景](#2-langchain-生态全景)
3. [LangGraph 核心概念](#3-langgraph-核心概念)
4. [工具设计（Tools）](#4-工具设计tools)
5. [Agent Graph：ReAct 循环详解](#5-agent-graphreact-循环详解)
6. [流式输出：astream_events 与 SSE](#6-流式输出astream_events-与-sse)
7. [新旧架构对比](#7-新旧架构对比)
8. [扩展能力](#8-扩展能力)
9. [关键代码走读](#9-关键代码走读)

---

## 1. 什么是 Agent

### 1.1 一句话定义

**Agent = LLM + 工具调用能力 + 自主决策循环。**

普通 LLM 只能"说"，Agent 还能"做"——它可以决定何时调用外部工具、调用哪个工具、如何组合多个工具的结果来回答问题。

### 1.2 Agent vs 普通 RAG

| 维度 | 普通 RAG | Agent（ReAct） |
|------|----------|----------------|
| **流程控制** | 固定流水线：查询 → 检索 → 拼接 Prompt → 生成 | LLM 自主决策：先思考是否需要检索，再决定调用哪个工具 |
| **检索策略** | 每次都检索，top_k 固定 | 可能不检索、检索一次、或多次检索并调整查询词 |
| **工具多样性** | 通常只有向量检索 | 同时拥有检索、查库、索引等多种工具 |
| **推理能力** | 无中间推理步骤 | 可以推理后行动、观察结果、再推理（ReAct 循环） |
| **错误处理** | 检索失败则整体失败 | Agent 可以感知错误、调整策略重试 |
| **典型场景** | "这篇论文讲了什么？" | "帮我把桌面上的 PDF 索引进去，然后和之前那篇对比一下异同" |

**具体举例：**

```
用户："Transformer 和 BERT 在注意力机制上有什么区别？"

普通 RAG：
  1. 把整个问题扔进向量检索 → 可能只命中 Transformer 相关片段
  2. 把检索结果和问题拼成 Prompt → 让 LLM 回答
  问题：BERT 相关的内容可能没被检索到，因为查询偏向 Transformer。

Agent（ReAct）：
  思考："用户要比较两个模型，我需要分别查找相关信息。"
  → 调用 search_knowledge("Transformer attention mechanism")
  → 观察：找到 3 条相关片段
  → 调用 search_knowledge("BERT self-attention")
  → 观察：找到 2 条相关片段
  → 思考："现在有了两方面的资料，可以综合比较了。"
  → 最终回答：基于 5 条检索结果的综合对比
```

### 1.3 ReAct 模式详解

ReAct（**Re**asoning + **Act**ing）是 2022 年 Yao et al. 提出的 Agent 范式，核心思想是让 LLM 在"思考"和"行动"之间交替进行：

```
┌─────────────────────────────────────────┐
│              ReAct 循环                   │
│                                         │
│   ┌──────────┐                          │
│   │ Thought  │ ← LLM 推理当前状态       │
│   └────┬─────┘                          │
│        │                                │
│        ▼                                │
│   ┌──────────┐    有工具需要调用？       │
│   │  Action  │ ──── 是 ───→ 调用工具    │
│   └────┬─────┘               │          │
│        │ 否                  ▼          │
│        ▼              ┌──────────┐      │
│   ┌──────────┐        │ Observe  │      │
│   │  Final   │        └────┬─────┘      │
│   │  Answer  │             │            │
│   └──────────┘             └──→ 回到 Thought
│                                         │
└─────────────────────────────────────────┘
```

**每一步的作用：**

| 步骤 | 英文 | 作用 | 举例 |
|------|------|------|------|
| 思考 | Thought | LLM 分析当前信息，决定下一步 | "我需要先搜索相关论文" |
| 行动 | Action | 选择并调用具体工具 | `search_knowledge("Attention is All You Need")` |
| 观察 | Observe | 接收工具返回的结果 | 检索到 3 条相关文档片段 |
| 最终回答 | Final Answer | 信息充足时，直接给出答案 | 综合所有检索结果生成回答 |

**为什么 ReAct 比单次检索更强大？** 因为 LLM 可以：
- **分步推理**：把复杂问题拆成子问题，逐个检索
- **动态调整**：第一次检索结果不满意时，换一个查询词再试
- **工具组合**：先查文献库确认有哪些论文，再针对性地检索内容
- **主动索引**：用户提到一篇新论文，Agent 可以先索引再回答

---

## 2. LangChain 生态全景

ZoteroSeek 的 Agent 层依赖 LangChain 生态中的三个核心包，各司其职：

### 2.1 langchain-core — 基础抽象层

**职责：** 定义所有组件的统一接口（抽象基类），不包含任何具体实现。

**核心概念：**

| 概念 | 类 | 作用 |
|------|-----|------|
| Tool | `BaseTool` | 工具的抽象接口，定义了 `name`、`description`、`invoke()` 等 |
| Message | `BaseMessage` | 消息类型基类（`HumanMessage`、`AIMessage`、`ToolMessage`） |
| Chat Model | `BaseChatModel` | 聊天模型的抽象接口 |
| Output Parser | `BaseOutputParser` | 输出解析器接口 |
| `@tool` 装饰器 | — | 将普通函数转为 LangChain Tool 的语法糖 |

**为什么重要：** 它是"胶水层"——所有 LangChain 组件通过这套接口互通。你在 `tools.py` 中使用的 `@tool` 装饰器就来自这里：

```python
from langchain_core.tools import tool

@tool
async def search_knowledge(query: str, top_k: int = 5) -> str:
    """搜索已索引的学术论文知识库。"""
    # ... 实现逻辑
```

`@tool` 做了三件事：
1. 从函数名生成 `name = "search_knowledge"`
2. 从 docstring 提取 `description`（这是 LLM 决定是否调用该工具的唯一依据！）
3. 从类型注解生成参数 schema（JSON Schema 格式，传给 LLM 的 function calling）

### 2.2 langchain-openai — 模型接入层

**职责：** 封装 OpenAI 兼容 API（也兼容 DeepSeek、Moonshot、Ollama 等任何 OpenAI 格式的 API）。

**在 ZoteroSeek 中的使用：**

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    api_key=settings.llm_api_key,
    base_url=settings.llm_base_url,  # 可指向任何 OpenAI 兼容端点
    model=settings.llm_model,         # 如 "gpt-4o-mini"、"deepseek-chat" 等
    streaming=True,
    temperature=0.7,
)
```

**关键参数解析：**

| 参数 | 作用 | ZoteroSeek 的选择 |
|------|------|-------------------|
| `streaming=True` | 启用 token 级流式输出 | 必须开启，配合 SSE 实现逐字输出 |
| `temperature=0.7` | 控制生成随机性 | 0.7 平衡了创造性和准确性 |
| `base_url` | API 端点地址 | 通过配置切换不同 LLM 提供商 |

**为什么不直接用 OpenAI SDK？** LangChain 的 `ChatOpenAI` 额外提供了：
- 统一的消息格式（`HumanMessage`、`AIMessage`）
- 内置的 tool calling 解析（自动将 function call 结果转为 `ToolMessage`）
- 流式事件标准化（`astream_events` 的事件格式）
- 与 LangGraph 的无缝集成

### 2.3 langchain-chroma — 向量存储接入层

**职责：** 封装 ChromaDB 向量数据库的操作接口。

> **注意：** ZoteroSeek 目前通过自定义的 `ChromaVectorStore` 封装层与 ChromaDB 交互，未来可逐步迁移到 `langchain-chroma` 以获得更深度的 LangChain 集成（如 `Chroma.as_retriever()` 直接返回 LangChain Retriever）。

**三者的关系：**

```
┌────────────────────────────────────────────────────┐
│                 你的应用代码                          │
│            （tools.py / graph.py）                   │
├────────────────────────────────────────────────────┤
│  langchain-core     langchain-openai                │
│  (接口抽象)          (LLM 接入)                      │
│                                                     │
│  @tool              ChatOpenAI                      │
│  BaseTool           streaming=True                  │
│  Messages           tool calling 解析               │
├────────────────────────────────────────────────────┤
│              LangGraph（编排层）                      │
│         create_react_agent / StateGraph             │
├────────────────────────────────────────────────────┤
│  langchain-chroma                                    │
│  (向量存储接入)                                       │
│  Chroma / ChromaVectorStore                         │
└────────────────────────────────────────────────────┘
```

---

## 3. LangGraph 核心概念

LangGraph 是 LangChain 团队开发的 **Agent 编排框架**，核心思想是用**有向图**来描述 Agent 的执行流程。

### 3.1 为什么需要 LangGraph？

在 LangGraph 之前，Agent 的执行逻辑是用 `AgentExecutor` 隐式管理的——一个黑盒的 while 循环，很难定制。LangGraph 将 Agent 流程显式化为**图（Graph）**，每个节点是一个处理步骤，每条边定义了状态转移规则。

**核心优势：**

| 特性 | 说明 |
|------|------|
| **状态管理** | 用 TypedDict 定义明确的状态结构，每个节点读写状态 |
| **条件分支** | 支持 `add_conditional_edges()`，根据状态动态选择下一步 |
| **循环支持** | 天然支持 ReAct 的"思考 → 行动 → 观察"循环 |
| **流式输出** | `astream_events` 可以流式输出每个节点的中间结果 |
| **可视化** | 可以导出 Mermaid / PNG 图，直观理解 Agent 流程 |
| **持久化** | 支持 checkpoint，可以暂停和恢复 Agent 执行 |

### 3.2 核心概念详解

#### StateGraph（状态图）

```python
from langgraph.graph import StateGraph

# 定义状态结构
class AgentState(TypedDict):
    messages: list[BaseMessage]

# 创建状态图
graph = StateGraph(AgentState)
```

`StateGraph` 是 LangGraph 的核心类，它定义了一个**状态机**：
- **状态（State）**：一个 TypedDict，包含 Agent 执行过程中需要的所有数据
- **节点（Node）**：处理函数，接收当前状态、返回更新后的状态
- **边（Edge）**：连接节点的有向边，定义执行顺序

#### 节点（Node）

每个节点是一个 Python 函数，接收 `state` 参数：

```python
# 简单节点示例
def call_llm(state: AgentState) -> AgentState:
    """调用 LLM 进行推理"""
    messages = state["messages"]
    response = llm.invoke(messages)
    return {"messages": [response]}

graph.add_node("llm", call_llm)
```

在 ReAct Agent 中，LangGraph 预置了两个核心节点：
- **`agent` 节点**：调用 LLM 进行推理，决定是回答还是调用工具
- **`tools` 节点**：执行工具调用，返回工具结果

#### 边（Edge）

```python
# 普通边：无条件跳转
graph.add_edge("start", "llm")

# 条件边：根据状态决定跳转到哪个节点
graph.add_conditional_edges(
    "llm",                    # 源节点
    should_call_tools,        # 路由函数
    {
        True: "tools",        # 需要调用工具 → 跳转到 tools 节点
        False: END,           # 不需要 → 结束
    }
)
```

#### 条件路由（Conditional Edges）

这是 ReAct 循环的关键——LLM 的输出决定下一步走向：

```python
def should_call_tools(state: AgentState) -> bool:
    """判断 LLM 输出是否包含工具调用"""
    last_message = state["messages"][-1]
    return hasattr(last_message, "tool_calls") and len(last_message.tool_calls) > 0
```

### 3.3 create_react_agent — 预构建的 ReAct 图

LangGraph 提供了 `create_react_agent` 工厂函数，一行代码创建完整的 ReAct Agent：

```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(
    llm,                    # ChatModel 实例
    tools,                  # 工具列表
    prompt=SYSTEM_PROMPT,   # 系统提示词
)
```

**它在底层做了什么？** `create_react_agent` 等价于手动构建如下状态图：

```
         ┌─────────────────────────────────────┐
         │                                      │
         ▼                                      │
    ┌─────────┐    LLM 输出包含工具调用    ┌─────────┐
    │  agent  │ ─────────────────────────→ │  tools  │
    │ (LLM)  │                             │(执行工具)│
    └────┬────┘                             └────┬────┘
         │                                      │
         │ LLM 输出不含工具调用                    │
         │（直接回答）                              │
         ▼                                      │
       ┌────┐                                   │
       │ END│ ←─────────────────────────────────┘
       └────┘     （工具结果返回给 agent 节点继续推理）
```

展开为代码，等价于：

```python
graph = StateGraph(AgentState)

# 添加节点
graph.add_node("agent", call_model)
graph.add_node("tools", tool_node)

# 添加边
graph.set_entry_point("agent")
graph.add_conditional_edges("agent", should_call_tools, {
    True: "tools",
    False: END,
})
graph.add_edge("tools", "agent")  # 工具结果总是返回给 agent

app = graph.compile()
```

**为什么用 `create_react_agent` 而不是手动构建？** 因为：
1. 它内置了正确的 message 处理逻辑（`ToolMessage` 的格式、多轮工具调用等）
2. 它处理了 edge case（工具报错、LLM 输出格式异常等）
3. 对于标准 ReAct 模式，手动构建没有额外收益

### 3.4 Agent Graph 可视化

ZoteroSeek 的 Agent Graph 结构：

```
                         START
                           │
                           ▼
                ┌─────────────────────┐
                │                     │
                │     agent 节点       │
                │   (ChatOpenAI LLM)  │
                │                     │
                └──────────┬──────────┘
                           │
                 ┌─────────┴─────────┐
                 │                   │
            有工具调用？          无工具调用
                 │                   │
                 ▼                   ▼
        ┌─────────────────┐     ┌──────┐
        │   tools 节点     │     │  END │
        │                 │     └──────┘
        │ ┌─────────────┐ │
        │ │search_know..│ │
        │ │query_library│ │
        │ │index_docu.. │ │
        │ └─────────────┘ │
        └────────┬────────┘
                 │
                 └──→ 返回 agent 节点（继续推理）
```

---

## 4. 工具设计（Tools）

ZoteroSeek 为 Agent 提供了三个工具，覆盖了学术研究助手的核心功能：

### 4.1 工具总览

| 工具 | 触发场景 | 底层依赖 | 是否有副作用 |
|------|---------|----------|-------------|
| `search_knowledge` | 用户询问论文内容、研究方法、学术概念 | `Retriever` + `ChromaVectorStore` | 否（只读） |
| `query_library` | 用户问"我有哪些论文" | SQLite `Item` 表 | 否（只读） |
| `index_document` | 用户提供 PDF 路径要求索引 | `IngestionPipeline` 全链路 | **是（写入向量库）** |

### 4.2 search_knowledge — 语义检索工具

**设计思路：** 这是 Agent 使用最频繁的工具。用户提出任何学术问题，Agent 都会优先调用它。

```python
@tool
async def search_knowledge(query: str, top_k: int = 5) -> str:
    """搜索已索引的学术论文知识库。当用户询问关于论文内容、研究方法、
    学术概念等问题时，必须先使用此工具搜索相关文献片段。

    Args:
        query: 搜索查询（自然语言）
        top_k: 返回结果数量（默认 5）
    """
```

**实现细节：**

1. **延迟导入（Lazy Import）：** `shared_deps` 中的依赖在函数体内导入，避免循环引用
2. **幂等初始化：** `ensure_vector_store()` 确保向量存储只初始化一次
3. **结果格式化：** 每条结果包含标题、章节类型、相关度分数、内容摘要（前 500 字符）

**返回格式示例：**

```
[1] Attention Is All You Need (method) [相关度: 0.892]
The dominant sequence transduction models are based on complex recurrent
or convolutional neural networks...

---

[2] BERT: Pre-training of Deep Bidirectional Transformers (introduction) [相关度: 0.847]
We introduce a new language representation model called BERT...
```

**关键设计决策：**
- `top_k` 默认 5，平衡信息量和 token 消耗
- 内容截断到 500 字符，避免单次工具返回过长，占用 LLM 上下文窗口
- 相关度分数帮助 LLM 判断结果质量

### 4.3 query_library — 文献库查询工具

**设计思路：** 回答"我有哪些论文"这类元信息查询，无需向量检索。

```python
@tool
async def query_library() -> str:
    """查看已索引的文献库列表。当用户问"我有哪些论文"、"文献库有什么"时使用。"""
```

**实现细节：**
- 直接查询 SQLite 的 `Item` 表，获取所有已索引文献
- 返回标题、年份、索引状态
- 比向量检索更快、更准确（这是结构化查询，不是语义搜索）

### 4.4 index_document — PDF 索引工具

**设计思路：** 让 Agent 具备"自我扩展"能力——用户提到一篇新论文，Agent 可以当场索引它。

```python
@tool
async def index_document(
    pdf_path: str,
    item_id: str = "manual",
    extractor: str = "mineru"
) -> str:
    """索引一篇新的 PDF 论文到知识库。当用户提供 PDF 文件路径要求索引时使用。"""
```

**实现细节：**
- 复用 `IngestionPipeline` 全链路：提取 → 解析 → 分块 → 嵌入 → 存储
- 支持两种提取器：`mineru`（高质量，推荐）和 `pymupdf`（快速）
- 返回索引结果：成功时报告块数量和耗时，失败时返回错误信息

### 4.5 工具设计的通用原则

**1. Docstring 就是 API 文档**

```python
@tool
async def search_knowledge(query: str, top_k: int = 5) -> str:
    """搜索已索引的学术论文知识库。当用户询问关于论文内容、研究方法、
    学术概念等问题时，必须先使用此工具搜索相关文献片段。  # ← LLM 读这个来决定何时调用
    Args:
        query: 搜索查询（自然语言）                       # ← LLM 读这个来决定传什么参数
        top_k: 返回结果数量（默认 5）
    """
```

`@tool` 装饰器会将 docstring 提取为 `description`，将参数类型注解提取为 JSON Schema。**LLM 完全依赖这些文本信息来决定是否调用工具以及如何调用**——所以写好 docstring 是工具设计的核心。

**2. 返回字符串，不是对象**

工具必须返回 `str` 类型。LLM 看到的是纯文本，不能处理 Python 对象。所以：
- 检索结果要格式化为可读文本
- 包含关键元信息（标题、分数）
- 适当截断，避免过长

**3. 错误要人话化**

```python
if not results:
    return "未找到相关文献。知识库中可能没有与该查询相关的内容。"
```

不要返回技术性错误（如 `None` 或 `[]`），要返回 LLM 能理解并转述给用户的自然语言。

---

## 5. Agent Graph：ReAct 循环详解

### 5.1 完整的请求生命周期

以用户问 "Transformer 的注意力机制是怎么工作的？" 为例，完整走一遍 Agent 的执行流程：

```
═══════════════════════════════════════════════════════════════
请求到达：POST /chat  { "message": "Transformer 的注意力机制是怎么工作的？" }
═══════════════════════════════════════════════════════════════

Step 1 — 构建初始状态
──────────────────────
{
    "messages": [
        HumanMessage("Transformer 的注意力机制是怎么工作的？")
    ]
}

Step 2 — agent 节点：LLM 推理
──────────────────────────────
LLM 收到消息 + 系统提示词 + 工具列表
LLM 思考："用户在问一个学术问题，我应该先搜索知识库。"
LLM 输出一个 tool_call：
{
    "name": "search_knowledge",
    "args": {
        "query": "Transformer self-attention mechanism",
        "top_k": 5
    }
}

Step 3 — 条件路由
─────────────────
检查 LLM 输出 → 发现有 tool_calls → 路由到 tools 节点

Step 4 — tools 节点：执行工具
────────────────────────────
调用 search_knowledge("Transformer self-attention mechanism", top_k=5)
→ EmbeddingClient 将查询编码为向量
→ ChromaVectorStore 执行相似度搜索
→ 返回 3 条相关文档片段
→ 格式化为文本

生成 ToolMessage：
{
    "role": "tool",
    "content": "[1] Attention Is All You Need (method) [相关度: 0.892]\n..."
}

Step 5 — 回到 agent 节点：LLM 再次推理
───────────────────────────────────────
LLM 收到所有 messages（包括工具结果）
LLM 思考："我找到了相关资料，信息足够回答问题了。"
LLM 输出纯文本回答（无 tool_calls）：
"Transformer 的注意力机制核心是 Scaled Dot-Product Attention..."

Step 6 — 条件路由
─────────────────
检查 LLM 输出 → 无 tool_calls → 路由到 END

Step 7 — 流式输出
─────────────────
每个 token 通过 SSE 发送给前端
最终发送 sources 和 [DONE] 标记
```

### 5.2 多轮工具调用场景

当一次检索不够时，Agent 会自主进行多次工具调用：

```
用户："对比 Transformer 和 RNN 在长序列处理上的优劣"

Round 1:
  Thought: "我需要分别查找 Transformer 和 RNN 的相关信息"
  Action:  search_knowledge("Transformer long sequence processing")
  Observe: 找到 2 条结果

Round 2:
  Thought: "还需要查找 RNN 的相关内容"
  Action:  search_knowledge("RNN sequence modeling limitations vanishing gradient")
  Observe: 找到 3 条结果

Round 3:
  Thought: "信息充分了，可以综合回答"
  Final Answer: 基于 5 条检索结果的综合对比分析
```

### 5.3 工具组合场景

Agent 可以在一次对话中调用不同类型的工具：

```
用户："我有哪些论文？帮我把 Transformer 那篇的关键方法总结一下"

Round 1:
  Action: query_library()
  Observe: "已索引 5 篇文献：\n- Attention Is All You Need (2017)\n- ..."

Round 2:
  Action: search_knowledge("Transformer key methodology architecture")
  Observe: 找到相关片段

Round 3:
  Final Answer: "您的文献库中有 5 篇论文。其中 Transformer 论文的核心方法是..."
```

---

## 6. 流式输出：astream_events 与 SSE

### 6.1 为什么需要流式输出？

LLM 生成一个完整回答可能需要 3-10 秒。如果等全部生成完再返回，用户体验极差（页面白屏 3-10 秒）。流式输出实现"逐字显示"，用户几乎感觉不到延迟。

### 6.2 astream_events API

`astream_events` 是 LangGraph 提供的流式事件 API，它将 Agent 执行过程中的所有事件以流的形式输出：

```python
async for event in agent.astream_events(
    {"messages": [("human", request.message)]},
    version="v2",
):
    kind = event.get("event", "")
    # 处理不同类型的事件
```

**事件类型（event kind）：**

| 事件类型 | 触发时机 | 包含数据 | ZoteroSeek 如何处理 |
|----------|---------|----------|-------------------|
| `on_chat_model_stream` | LLM 每生成一个 token | `chunk.content`（单个 token 文本） | 通过 SSE 发送给前端 |
| `on_chat_model_end` | LLM 完成一轮生成 | 完整的 response 对象 | — |
| `on_tool_start` | 工具开始执行 | 工具名和参数 | — |
| `on_tool_end` | 工具执行完成 | 工具输出 | 收集 `search_knowledge` 的结果作为 sources |
| `on_chain_start` | 链/节点开始执行 | — | — |
| `on_chain_end` | 链/节点执行完成 | — | — |

**完整事件流示例（用户问 "Transformer 注意力机制"）：**

```
event: on_chain_start          # Agent 开始执行
event: on_chat_model_stream    # LLM 开始生成 → 这里输出的是 tool_call
event: on_chat_model_end       # LLM 完成 → 输出了 search_knowledge 的调用
event: on_tool_start           # search_knowledge 开始执行
event: on_tool_end             # search_knowledge 完成 → 返回检索结果
event: on_chat_model_stream    # LLM 开始生成最终回答 → "Trans..."
event: on_chat_model_stream    # "...former..."
event: on_chat_model_stream    # " 的..."
event: on_chat_model_end       # LLM 完成最终回答
event: on_chain_end            # Agent 执行结束
```

### 6.3 SSE 协议设计

ZoteroSeek 使用 Server-Sent Events（SSE）协议将流式数据推送给前端：

```
data: Trans         ← on_chat_model_stream 的 token
data: former
data:  的
data: 注意力
data: 机制
data: ...
sources: [{"tool":"search_knowledge","output_preview":"[1] Attention Is All You Need..."}]
data: [DONE]
```

**协议格式：**

| 字段 | 格式 | 说明 |
|------|------|------|
| `data: {chunk}\n\n` | SSE 标准格式 | LLM 生成的每个 token |
| `sources: {json}\n\n` | 自定义格式 | 引用来源（仅当调用了 search_knowledge 时） |
| `data: [DONE]\n\n` | 自定义结束标记 | 流结束信号 |

**前端解析逻辑：**

```javascript
const eventSource = new EventSource('/chat');
eventSource.onmessage = (event) => {
    if (event.data === '[DONE]') {
        // 流结束
        eventSource.close();
    } else {
        // 追加 token 到显示区域
        appendToChat(event.data);
    }
};
// sources 通过自定义事件类型处理
```

### 6.4 代码走读：chat.py 的流式生成

```python
async def generate():
    sources = []
    try:
        async for event in agent.astream_events(
            {"messages": [("human", request.message)]},
            version="v2",
        ):
            kind = event.get("event", "")

            # ① LLM 输出的 token → 直接推送给前端
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and chunk.content:
                    yield f"data: {chunk.content}\n\n"

            # ② 工具执行完成 → 收集引用来源
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

    # ③ 流结束前发送引用来源和结束标记
    if sources:
        yield f"sources: {json.dumps(sources, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
```

**关键设计点：**

1. **只推送 LLM 的文本输出**：`on_chat_model_stream` 事件中的 `chunk.content` 是纯文本 token，不包含工具调用等元信息
2. **Sources 延迟发送**：先推送所有 token，最后一次性发送 sources——因为 sources 需要等工具执行完才能收集齐全
3. **错误处理**：异常不会导致连接断开，而是通过 SSE 发送错误信息，前端可以优雅处理

### 6.5 version="v2" 的意义

LangChain 的 `astream_events` 有两个版本：
- **v1**（旧版）：事件结构不统一，不同组件输出格式不同
- **v2**（推荐版）：统一的事件结构，`event.event` + `event.name` + `event.data`

ZoteroSeek 使用 v2，确保事件格式稳定可靠。

---

## 7. 新旧架构对比

### 7.1 旧架构：手写 RAG 流程

```
用户提问
   │
   ▼
┌──────────────┐
│ PromptRegistry│ ← 从预定义模板中选择 Prompt
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Retriever   │ ← 每次都执行向量检索（固定 top_k）
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  LLMClient   │ ← 拼接 Prompt + 检索结果 → 调用 LLM
└──────┬───────┘
       │
       ▼
   流式返回
```

**特点：**
- 流程固定：每次都是 检索 → 拼接 → 生成
- 无推理能力：LLM 只负责"生成回答"，不参与"决策"
- 单一工具：只有向量检索，无法查询文献库或索引新论文

### 7.2 新架构：LangGraph Agent

```
用户提问
   │
   ▼
┌──────────────┐
│  Agent 节点   │ ← LLM 推理：要不要用工具？用哪个？
└──────┬───────┘
       │
   ┌───┴───┐
   │       │
   ▼       ▼
 工具调用   直接回答
   │       │
   ▼       ▼
┌──────────┐  ┌──────┐
│ Tools 节点│  │ END  │
│          │  └──────┘
│ • search │
│ • query  │
│ • index  │
└────┬─────┘
     │
     └──→ 返回 Agent 节点
```

**特点：**
- 流程动态：LLM 自主决策使用哪些工具、以什么顺序使用
- 多步推理：支持多次工具调用和中间推理
- 多工具协作：检索、查库、索引三种工具灵活组合

### 7.3 详细对比表

| 维度 | 旧架构（手写 RAG） | 新架构（LangGraph Agent） |
|------|-------------------|-------------------------|
| **流程控制** | 代码硬编码 | LLM 动态决策 |
| **检索次数** | 固定 1 次 | 0-N 次，由 LLM 决定 |
| **查询质量** | 直接用用户原始问题检索 | LLM 可以改写查询词再检索 |
| **工具数量** | 1 个（向量检索） | 3 个（检索 + 查库 + 索引） |
| **错误恢复** | 检索失败则整体失败 | Agent 可以感知错误并调整策略 |
| **代码量** | ~100 行（自定义流水线） | ~70 行（利用 LangGraph 框架） |
| **可观测性** | 需要手动加日志 | `astream_events` 自动输出每步状态 |
| **扩展性** | 添加新功能需要改流程 | 添加新工具只需注册一个 `@tool` 函数 |
| **依赖** | 无额外框架 | LangChain + LangGraph |
| **上下文利用** | 单轮，不记忆之前的对话 | 天然支持多轮对话（messages 列表） |

### 7.4 迁移的实际收益

**1. 查询改写能力**

旧架构中，用户问 "Transformer 那篇论文的注意力机制" → 直接用整句话检索 → 可能匹配不到（query 太长，语义稀释）。

新架构中，LLM 会先思考："用户在问 Transformer 论文的注意力机制"，然后生成更精准的查询 `"Transformer self-attention mechanism"` → 检索效果大幅提升。

**2. 多步推理能力**

旧架构无法处理 "帮我索引桌面上的 PDF，然后总结它的核心贡献" 这种需要先执行操作再回答的问题。新架构中 Agent 会先调用 `index_document`，再调用 `search_knowledge` 检索新索引的内容，最后综合回答。

**3. 代码可维护性**

旧架构的流程控制散落在多个模块中（`chat.py`、`retriever.py`、`prompt_registry.py`），修改流程需要理解整个调用链。新架构的核心逻辑集中在 `graph.py`（创建 Agent）和 `tools.py`（定义工具），结构清晰。

---

## 8. 扩展能力

### 8.1 添加新工具

添加新工具只需三步：

**Step 1：在 `tools.py` 中定义工具函数**

```python
@tool
async def web_search(query: str) -> str:
    """搜索互联网获取最新学术信息。当知识库中找不到相关内容，
    或用户询问最新研究进展时使用。

    Args:
        query: 搜索查询
    """
    # 实现搜索逻辑
    results = await some_search_api(query)
    return format_results(results)
```

**Step 2：在 `graph.py` 中注册工具**

```python
from backend.agent.tools import search_knowledge, query_library, index_document, web_search

def get_agent():
    # ...
    tools = [search_knowledge, query_library, index_document, web_search]
    _agent = create_react_agent(llm, tools, prompt=AGENT_SYSTEM_PROMPT)
```

**Step 3：更新系统提示词**

```python
AGENT_SYSTEM_PROMPT = """You are ZoteroSeek...
Your capabilities:
1. search_knowledge — 搜索已索引论文
2. query_library — 查看文献库
3. index_document — 索引新 PDF
4. web_search — 搜索互联网获取最新信息  ← 新增
...
"""
```

**不需要修改 `chat.py`**——因为 `astream_events` 自动输出所有工具的事件，前端只关注 `on_chat_model_stream` 和 `on_tool_end`。

### 8.2 添加记忆（Memory）

LangGraph 原生支持 checkpoint（检查点）机制，可以实现对话记忆：

```python
from langgraph.checkpoint.memory import MemorySaver

def get_agent():
    llm = ChatOpenAI(...)
    tools = [search_knowledge, query_library, index_document]

    memory = MemorySaver()  # 内存存储（生产环境可用 Redis/SQLite）

    _agent = create_react_agent(
        llm,
        tools,
        prompt=AGENT_SYSTEM_PROMPT,
        checkpointer=memory,  # ← 启用 checkpoint
    )
```

**调用时传入 thread_id：**

```python
# 在 chat.py 中
config = {"configurable": {"thread_id": user_session_id}}

async for event in agent.astream_events(
    {"messages": [("human", request.message)]},
    config=config,  # ← 传入配置
    version="v2",
):
    ...
```

**效果：** Agent 会自动加载该 `thread_id` 的历史对话，实现多轮记忆。用户说"刚才那篇论文"时，Agent 能理解指的是之前讨论过的论文。

**MemorySaver vs 持久化存储：**

| 方案 | 适用场景 | 数据持久性 |
|------|---------|-----------|
| `MemorySaver` | 开发 / 单机部署 | 进程内存，重启丢失 |
| `SqliteSaver` | 单机生产环境 | SQLite 文件，持久化 |
| `RedisSaver` | 多实例部署 | Redis，分布式共享 |

### 8.3 多 Agent 协作

LangGraph 支持构建多 Agent 系统，每个 Agent 负责不同的任务域：

```
用户请求
   │
   ▼
┌──────────────┐
│  Supervisor  │ ← 调度 Agent：分析用户意图，分配给子 Agent
│  Agent       │
└──────┬───────┘
       │
  ┌────┼────────────┐
  │    │             │
  ▼    ▼             ▼
┌────┐┌────┐   ┌─────────┐
│检索││写作│   │ 索引     │
│Agent││Agent│  │ Agent   │
└──┬─┘└──┬─┘   └────┬────┘
   │     │          │
   └──┬──┘──────────┘
      │
      ▼
┌──────────────┐
│  Supervisor  │ ← 综合各子 Agent 结果，生成最终回答
│  Agent       │
└──────────────┘
```

**实现思路：**

```python
from langgraph.graph import StateGraph, MessagesState

# 定义各个专业 Agent
research_agent = create_react_agent(llm, [search_knowledge, query_library])
writing_agent = create_react_agent(llm, [summarize, compare, rewrite])

# 构建 Supervisor 图
def supervisor(state: MessagesState):
    """根据用户意图路由到合适的 Agent"""
    # 使用 LLM 分析意图并路由
    ...

graph = StateGraph(MessagesState)
graph.add_node("supervisor", supervisor)
graph.add_node("research", research_agent)
graph.add_node("writing", writing_agent)
# ... 添加条件边
```

**ZoteroSeek 的扩展方向：**

| 子 Agent | 职责 | 工具 |
|----------|------|------|
| 检索 Agent | 专注学术文献搜索与知识提取 | search_knowledge, query_library |
| 索引 Agent | 专注 PDF 解析、索引、元数据管理 | index_document |
| 写作 Agent | 专注文献综述、论文对比、摘要生成 | summarize, compare |
| 翻译 Agent | 专注中英文学术翻译 | translate |

---

## 9. 关键代码走读

### 9.1 工具定义（tools.py）

```python
from langchain_core.tools import tool

@tool
async def search_knowledge(query: str, top_k: int = 5) -> str:
    """搜索已索引的学术论文知识库。当用户询问关于论文内容、研究方法、
    学术概念等问题时，必须先使用此工具搜索相关文献片段。

    Args:
        query: 搜索查询（自然语言）
        top_k: 返回结果数量（默认 5）
    """
    # 延迟导入 — 避免模块加载时的循环依赖
    from backend.api.shared_deps import embedder, vector_store, ensure_vector_store
    from backend.core.rag.retriever import Retriever

    # 幂等初始化 — 确保向量存储只初始化一次
    await ensure_vector_store()

    # 复用现有 Retriever — 不重复造轮子
    retriever = Retriever(embedder=embedder, vector_store=vector_store)
    results = await retriever.search(query=query, top_k=top_k)

    if not results:
        return "未找到相关文献。知识库中可能没有与该查询相关的内容。"

    # 格式化为 LLM 可读的文本
    parts = []
    for i, r in enumerate(results, 1):
        title = r.metadata.get("title", "Unknown")
        section = r.metadata.get("section_type", "")
        score = round(r.score, 3)
        parts.append(f"[{i}] {title} ({section}) [相关度: {score}]\n{r.content[:500]}")

    return "\n\n---\n\n".join(parts)
```

**要点解读：**
1. `@tool` 装饰器自动处理函数 → Tool 的转换（name、description、schema）
2. docstring 中的 `Args:` 部分会被提取为参数描述，LLM 依赖这些描述来生成正确的参数
3. `content[:500]` 截断是关键——避免单条工具结果占用过多 context window

### 9.2 Agent 创建（graph.py）

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

# 系统提示词 — 定义 Agent 的角色和行为规范
AGENT_SYSTEM_PROMPT = """You are ZoteroSeek, an AI research assistant..."""

_agent = None  # 延迟初始化的单例

def get_agent():
    global _agent
    if _agent is None:
        # ① 创建 LLM 实例
        llm = ChatOpenAI(
            api_key=settings.llm_api_key or "dummy",
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            streaming=True,      # 必须开启，否则无法流式输出
            temperature=0.7,
        )

        # ② 注册工具
        tools = [search_knowledge, query_library, index_document]

        # ③ 创建 ReAct Agent（一行代码！）
        _agent = create_react_agent(
            llm,
            tools,
            prompt=AGENT_SYSTEM_PROMPT,
        )
    return _agent
```

**要点解读：**
1. **单例模式**：Agent 创建涉及 LLM 客户端初始化，开销较大，只创建一次
2. **延迟初始化**：`settings` 在模块导入时可能还未加载，所以不在模块顶层创建
3. **streaming=True**：必须开启，`astream_events` 依赖 LLM 的流式输出能力
4. **`api_key or "dummy"`**：兼容无 key 场景（开发测试时 LLM 可能不需要 key）

### 9.3 流式输出（chat.py）

```python
@router.post("/chat")
async def chat(request: ChatRequest):
    agent = get_agent()

    async def generate():
        sources = []
        # 使用 astream_events 流式获取 Agent 执行事件
        async for event in agent.astream_events(
            {"messages": [("human", request.message)]},
            version="v2",
        ):
            kind = event.get("event", "")

            # LLM 的 token 级输出 → 实时推送给前端
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and chunk.content:
                    yield f"data: {chunk.content}\n\n"

            # 工具执行结果 → 收集引用来源
            elif kind == "on_tool_end":
                tool_name = event.get("name", "")
                tool_output = event.get("data", {}).get("output", "")
                if tool_name == "search_knowledge" and tool_output:
                    sources.append({
                        "tool": tool_name,
                        "output_preview": tool_output[:300],
                    })

        # 流结束前：发送 sources 和 DONE 标记
        if sources:
            yield f"sources: {json.dumps(sources, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

**要点解读：**
1. **`generate()` 是异步生成器**：每次 `yield` 一个 SSE 消息，FastAPI 通过 `StreamingResponse` 实时推送给客户端
2. **事件过滤**：只处理 `on_chat_model_stream`（token 输出）和 `on_tool_end`（工具结果），忽略其他事件
3. **Sources 延迟收集**：在循环中收集，在循环结束后一次性发送——确保所有工具执行完毕
4. **`media_type="text/event-stream"`**：告诉浏览器这是 SSE 流，需要使用 `EventSource` 接收

### 9.4 依赖管理（shared_deps.py）

```python
# 模块级单例 — 整个应用共享同一组实例
embedder = EmbeddingClient()
vector_store = ChromaVectorStore()
parser = DocumentParser()
chunker = SemanticChunker()

_vector_store_initialized = False

async def ensure_vector_store():
    """确保向量存储已初始化（幂等）"""
    global _vector_store_initialized
    if not _vector_store_initialized:
        await vector_store.initialize()
        _vector_store_initialized = True
```

**为什么工具内部使用延迟导入？**

```python
@tool
async def search_knowledge(query: str, top_k: int = 5) -> str:
    from backend.api.shared_deps import embedder, vector_store, ensure_vector_store  # ← 函数内导入
    ...
```

因为 `shared_deps` 在模块加载时会创建各种客户端实例，而 `tools.py` 可能在 `shared_deps` 初始化完成之前就被导入。延迟导入确保在实际调用工具时，所有依赖已经就绪。

---

## 附录：常见问题

### Q1: 为什么不手动构建 StateGraph 而用 create_react_agent？

`create_react_agent` 适用于标准 ReAct 模式（单个 agent + 多个 tools 的循环）。如果需要更复杂的流程（多 agent 协作、人工介入节点、条件分支），则需要手动构建 `StateGraph`。

ZoteroSeek 当前的需求完全符合标准 ReAct 模式，所以用 `create_react_agent` 是最优选择——代码最少、出 bug 概率最低、最容易维护。

### Q2: 工具的 docstring 有多重要？

**极其重要。** LLM 看不到工具的源代码，它唯一的决策依据就是：
1. `name`（工具名）
2. `description`（docstring 的内容）
3. `parameters`（参数名、类型、描述）

如果 docstring 写得不清楚，LLM 可能：
- 不知道何时该调用这个工具
- 传入错误的参数
- 在不该调用时调用（浪费 token 和时间）

### Q3: temperature=0.7 的选择依据？

- **0.0**：完全确定性，每次输出相同。适合代码生成、分类任务。
- **0.7**：适度随机，兼顾准确性和自然性。适合学术问答助手。
- **1.0+**：高随机性，适合创意写作。

ZoteroSeek 选择 0.7 是因为学术助手需要准确回答问题（不能太随机），但回答的表述方式可以多样（不能太死板）。

### Q4: 为什么 tools 都是 async 的？

因为底层依赖（EmbeddingClient、ChromaVectorStore、LLMClient）都是基于 `httpx` 的异步 HTTP 客户标。如果工具是同步的，会阻塞事件循环，导致：
- 流式输出中断
- 并发请求排队
- 整体吞吐量下降

LangGraph 原生支持异步工具，`create_react_agent` 会自动使用 `ainvoke` 调用异步工具。

### Q5: astream_events 的版本选择

```python
async for event in agent.astream_events(input, version="v2"):
```

`version="v2"` 是目前推荐的事件格式版本。v1 的事件结构因组件类型不同而差异较大，v2 统一为 `{"event": str, "name": str, "data": dict}` 格式，更易于解析。
