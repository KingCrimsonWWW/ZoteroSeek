# 04 — 前端架构

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.2 | UI 框架 |
| TypeScript | 5.3 | 类型安全 |
| Vite | 5.0 | 构建 + 开发服务器 + API 代理 |
| Tailwind CSS | 3.4 | 原子化 CSS + 深色模式 |
| Zustand | 4.4 | 轻量状态管理 |
| ReactMarkdown | — | Markdown 渲染 |
| lucide-react | — | 图标库 |
| axios | 1.6 | REST HTTP 客户端 |
| fetch API | 原生 | SSE 流式通信 |

---

## 组件结构

```
App.tsx                     ← 根组件：Liquid Glass 导航 + 侧边栏 + 视图切换
├── SessionSidebar.tsx      ← 会话列表（多会话管理）
├── Chat.tsx                ← 对话界面（Markdown 渲染 + 来源面板 + 消息操作）
├── Library.tsx             ← 文献库管理（Zotero 集成 + 批量索引）
└── Search.tsx              ← 语义搜索（结果展示 + Score 可视化）

stores/
├── chatStore.ts            ← 聊天状态（流式消息处理）
├── sessionStore.ts         ← 会话管理（localStorage 持久化）
└── themeStore.ts           ← 主题切换（深色/浅色/系统）

api/
└── client.ts               ← HTTP 客户端（axios + fetch SSE 双引擎）
```

---

## 核心设计

### 1. 双引擎 HTTP 策略

```typescript
// api/client.ts

// 普通 REST 请求 → axios（拦截器、类型推导、错误处理更方便）
const api = axios.create({ baseURL: '/api/v1' })
api.get('/health')
api.post('/search', { query, top_k })

// SSE 流式请求 → 原生 fetch（axios 不支持 ReadableStream）
const response = await fetch('/api/v1/chat', { method: 'POST', body: ... })
const reader = response.body.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // 解析 SSE 行：data: {chunk}\n\n
}
```

**为什么不用 WebSocket？** SSE 是单向的（服务端→客户端），适合"一问一答"的聊天场景。基于 HTTP，天然支持 CORS、代理、负载均衡。

### 2. 流式消息处理

```typescript
// stores/chatStore.ts — "placeholder-then-fill" 模式

sendMessage: async (content) => {
  // 1. 添加用户消息
  addMessage({ role: 'user', content })
  
  // 2. 添加空的 assistant 消息占位（显示 Thinking...）
  addMessage({ role: 'assistant', content: '' })
  setLoading(true)
  
  // 3. 流式填充 assistant 消息
  let assistantContent = ''
  await apiClient.chat(content, (chunk) => {
    assistantContent += chunk
    updateLastMessage(assistantContent)  // 逐 token 更新
  })
  
  setLoading(false)
}
```

### 3. Zustand 状态管理

```typescript
// 为什么选 Zustand 而不是 Redux？
// - 一个 create() 就是一个 store，无需 Provider 包裹
// - TypeScript 支持好，自动推导类型
// - 自动精确订阅，不需要 selector
// - 代码量是 Redux 的 1/5

const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  sendMessage: async (content) => { ... },
}))
```

### 4. 会话持久化

```typescript
// stores/sessionStore.ts

// 使用 localStorage 持久化会话
// 为什么不存后端？— 纯本地工具，不需要服务端状态
// 为什么不用 IndexedDB？— Zotero 9 沙盒中 IndexedDB 不可用
const saveSessions = (sessions) => {
  localStorage.setItem('zoteroseek-sessions', JSON.stringify(sessions))
}
```

### 5. Liquid Glass UI 设计

```tsx
// 导航栏 — 毛玻璃效果
<div className="bg-white/70 backdrop-blur-xl border border-white/20 
                rounded-2xl shadow-lg shadow-black/5">

// 流动 Tab 指示器
<div className="absolute bg-white/90 rounded-lg shadow-sm 
                transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
     style={{ left: indicatorStyle.left, width: indicatorStyle.width }} />

// 悬浮输入框
<div className="bg-white/60 backdrop-blur-2xl shadow-xl border border-white/30 
                rounded-2xl">
```

**关键 CSS 属性**：
- `backdrop-blur-xl`：背景模糊（毛玻璃核心）
- `bg-white/60`：60% 不透明度
- `border-white/20`：半透明边框
- `cubic-bezier(0.4,0,0.2,1)`：Material Design 标准缓动

---

## 消息操作

```tsx
// Chat.tsx — 用户消息气泡操作

{msg.role === 'user' && (
  <div className="flex justify-end gap-1 mt-1">
    <CopyButton text={msg.content} />     {/* 复制 */}
    <button onClick={() => {
      setInput(msg.content)               // 回填到输入框
      deleteMessagesFromIndex(i)          // 删除该消息及之后的所有消息
    }}>
      <Pencil className="w-3 h-3" /> Edit
    </button>
  </div>
)}
```

**Edit 流程**：点击 Edit → 消息回填到输入框 → 删除该点之后的消息 → 用户修改后重新发送 → LLM 重新回答

---

## 深色模式

```typescript
// stores/themeStore.ts — 三层同步

// 1. React state（驱动 UI 重渲染）
const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')

// 2. DOM classList（Tailwind dark: 前缀生效）
document.documentElement.classList.toggle('dark', isDark)

// 3. localStorage（持久化用户选择）
localStorage.setItem('zoteroseek-theme', theme)

// 优先级：用户手动选择 > 系统偏好 > 默认浅色
// 防止 FOUC（Flash of Unstyled Content）：模块顶层立即执行 applyTheme()
```
