/**
 * ChatStore — 聊天状态管理
 *
 * 设计思路：
 * 本文件使用 Zustand 管理聊天的核心加载状态，而将消息列表的持久化
 * 委托给 sessionStore。这种"职责分离"的设计让 chatStore 专注于
 * 异步流式通信逻辑，sessionStore 专注于会话生命周期管理，避免单一
 * store 过于臃肿。
 *
 * 为什么选 Zustand 而不是 Redux Toolkit / Jotai：
 * - Zustand 的 create() API 极简，无需 Provider 包裹，无需 boilerplate
 * - 跨 store 调用只需 useXxxStore.getState()，天然支持 store 间协作
 * - 体积小（约 1KB），无额外依赖
 */
import { create } from 'zustand'
import { apiClient, type ChatSource } from '@/api/client'
import { useSessionStore } from './sessionStore'

/** Store 的状态接口定义 */
interface ChatState {
  /** 是否正在等待后端响应（用于禁用输入框、显示 loading 等） */
  isLoading: boolean
  /** 发送一条用户消息并触发流式回复 */
  sendMessage: (content: string) => Promise<void>
  /** 清空当前活跃会话的所有消息 */
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  isLoading: false,

  /**
   * 发送消息的完整流程：
   * 1. 将用户消息追加到 sessionStore 的活跃会话
   * 2. 立刻追加一条空的 assistant 消息作为"占位"，这样 UI 能立即
   *    渲染出 Thinking 动画（因为 content 为空字符串时显示加载态）
   * 3. 调用 apiClient.chat() 启动 SSE 流式请求
   * 4. 每收到一个 chunk 就实时更新 assistant 占位消息的内容
   * 5. 收到 sources 元数据后附加到消息中
   * 6. 流结束后做最终更新并关闭 loading 状态
   *
   * 为什么要"先占位再填充"而不是等全部数据回来再渲染：
   * - 用户体验：即时反馈，流式打字机效果
   * - 降低感知延迟：SSE 第一个 chunk 可能需要数秒
   */
  sendMessage: async (content: string) => {
    // 通过 getState() 跨 store 操作 —— Zustand 推荐的 store 间协作方式
    const sessionStore = useSessionStore.getState()

    // 添加用户消息
    sessionStore.addMessage({ role: 'user', content })
    // 添加 assistant 占位
    sessionStore.addMessage({ role: 'assistant', content: '' })
    set({ isLoading: true })

    // 用于累积流式返回的文本和引用源
    let assistantContent = ''
    let sources: ChatSource[] | undefined

    try {
      await apiClient.chat(
        content,
        // onChunk 回调：每收到一个 SSE 文本片段就触发一次
        (chunk) => {
          assistantContent += chunk
          // 每次 chunk 到达都实时更新最后一条消息，触发 React 重新渲染
          sessionStore.updateLastMessage(assistantContent, sources)
        },
        // onSources 回调：后端在流末尾发送引用源元数据
        (src) => {
          sources = src
        },
      )
    } catch (err) {
      // 错误处理：将错误信息追加到回复末尾，而不是丢弃已有的流式内容
      const errorMsg = err instanceof Error ? err.message : '请求失败'
      assistantContent += `\n\n⚠️ ${errorMsg}`
    }

    // 最终更新：确保 sources 被正确写入（可能在最后一次 onChunk 之后才到达）
    sessionStore.updateLastMessage(assistantContent, sources)
    set({ isLoading: false })
  },

  clearMessages: () => {
    // 委托给 sessionStore 清空当前活跃会话的消息
    useSessionStore.getState().clearActiveMessages()
  },
}))
