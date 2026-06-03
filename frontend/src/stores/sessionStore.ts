/**
 * SessionStore — 会话管理与持久化
 *
 * 设计思路：
 * 本 store 管理所有聊天会话的生命周期（创建、删除、重命名、切换），
 * 并负责将数据持久化到 localStorage。
 *
 * 为什么用 localStorage 而不是 IndexedDB / 后端存储：
 * - 聊天会话数据量通常较小（几十条消息），localStorage 的 5MB 限制足够
 * - 读写同步，无需 async/await，简化了 Zustand store 的实现
 * - 对于 MVP 阶段，localStorage 是最简单可靠的方案
 *
 * 为什么 Zustand store 内直接操作 localStorage（而非用 middleware）：
 * - Zustand 提供 persist middleware，但本项目选择手动调用 saveSessions()
 *   以获得更精细的控制：只在数据变更时序列化，而非每次 set() 都触发
 * - 手动方式更容易在 save 前做自定义逻辑（如排序、裁剪）
 */
import { create } from 'zustand'
import type { ChatMessage } from '@/api/client'

/** 单个聊天会话的数据结构 */
export interface ChatSession {
  /** 唯一标识，基于时间戳+随机数生成 */
  id: string
  /** 会话标题，首次由第一条用户消息截取生成 */
  title: string
  /** 该会话下的所有消息 */
  messages: ChatMessage[]
  /** 创建时间戳（毫秒） */
  createdAt: number
  /** 最后更新时间戳（毫秒），用于排序 */
  updatedAt: number
}

/** Store 的状态与操作接口 */
interface SessionState {
  /** 所有会话列表，按创建时间倒序排列（最新的在前面） */
  sessions: ChatSession[]
  /** 当前选中的会话 ID，null 表示尚未选择 */
  activeSessionId: string | null

  // --- 会话生命周期操作 ---

  /** 创建新会话并自动激活，返回新会话 ID */
  createSession: () => string
  /** 删除指定会话，若删除的是当前活跃会话则自动切换到列表第一个 */
  deleteSession: (id: string) => void
  /** 重命名会话 */
  renameSession: (id: string, title: string) => void
  /** 切换当前活跃会话 */
  setActiveSession: (id: string) => void
  /** 获取当前活跃会话对象（纯计算，无副作用） */
  getActiveSession: () => ChatSession | null

  // --- 消息操作（作用于 active session）---
  // 所有消息操作都限定在活跃会话内，简化了调用方的逻辑

  /** 向活跃会话追加一条消息 */
  addMessage: (msg: ChatMessage) => void
  /** 更新活跃会话的最后一条消息（用于流式写入场景） */
  updateLastMessage: (content: string, sources?: ChatMessage['sources']) => void
  /** 清空活跃会话的所有消息并重置标题 */
  clearActiveMessages: () => void
}

/**
 * 生成唯一 ID
 * 策略：时间戳的 36 进制 + 6 位随机字符
 * 这种方式在单用户场景下碰撞概率极低，且 ID 具有一定的时间可读性
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 自动生成会话标题
 * 策略：取第一条用户消息的前 40 个字符
 * 这是 ChatGPT 等主流对话产品的通用做法，简单实用
 */
function generateTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (firstUser) {
    const text = firstUser.content.slice(0, 40)
    return text.length < firstUser.content.length ? text + '...' : text
  }
  return 'New Chat'
}

/**
 * 从 localStorage 加载已有会话
 * 使用 try-catch 包裹以防 JSON 解析失败（如用户手动修改了存储数据）
 */
function loadSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem('zoteroseek-sessions')
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/** 将会话列表序列化写入 localStorage */
function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem('zoteroseek-sessions', JSON.stringify(sessions))
}

export const useSessionStore = create<SessionState>((set, get) => ({
  // 初始化时从 localStorage 恢复，实现跨页面刷新的数据持久化
  sessions: loadSessions(),
  activeSessionId: null,

  createSession: () => {
    const id = generateId()
    const session: ChatSession = {
      id,
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((state) => {
      // 新会话插入到列表头部，保证最新的在最上面
      const sessions = [session, ...state.sessions]
      saveSessions(sessions)
      return { sessions, activeSessionId: id }
    })
    return id
  },

  deleteSession: (id: string) => {
    set((state) => {
      const sessions = state.sessions.filter(s => s.id !== id)
      saveSessions(sessions)
      // 如果删除的是当前活跃会话，自动选择列表中的第一个
      // 使用可选链 ?. 和空值合并 ?? 处理列表为空的情况
      const activeSessionId = state.activeSessionId === id
        ? (sessions[0]?.id ?? null)
        : state.activeSessionId
      return { sessions, activeSessionId }
    })
  },

  renameSession: (id: string, title: string) => {
    set((state) => {
      // 使用 map + 条件展开实现不可变更新（immutable update）
      // 这是 React 状态管理的最佳实践，确保引用变化能触发重渲染
      const sessions = state.sessions.map(s =>
        s.id === id ? { ...s, title } : s
      )
      saveSessions(sessions)
      return { sessions }
    })
  },

  setActiveSession: (id: string) => {
    set({ activeSessionId: id })
  },

  getActiveSession: () => {
    // get() 用于在 store 方法内部读取当前状态（非 set 回调场景）
    const { sessions, activeSessionId } = get()
    return sessions.find(s => s.id === activeSessionId) ?? null
  },

  addMessage: (msg: ChatMessage) => {
    // 为每条消息分配唯一 ID，确保 React 列表渲染稳定性
    const msgWithId = { ...msg, id: msg.id || generateId() }

    set((state) => {
      let { activeSessionId, sessions } = state

      // 如果没有活跃会话，自动创建
      // 这是一个防御性设计：确保任何时候发送消息都有会话可以接收
      if (!activeSessionId) {
        const id = generateId()
        const session: ChatSession = {
          id,
          title: 'New Chat',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        sessions = [session, ...sessions]
        activeSessionId = id
      }

      sessions = sessions.map(s => {
        if (s.id !== activeSessionId) return s
        const messages = [...s.messages, msgWithId]
        return {
          ...s,
          messages,
          // 首次添加消息时自动从用户输入生成标题（替换默认的 "New Chat"）
          title: s.title === 'New Chat' ? generateTitle(messages) : s.title,
          updatedAt: Date.now(),
        }
      })

      saveSessions(sessions)
      return { sessions, activeSessionId }
    })
  },

  updateLastMessage: (content: string, sources?: ChatMessage['sources']) => {
    set((state) => {
      const sessions = state.sessions.map(s => {
        if (s.id !== state.activeSessionId) return s
        const messages = [...s.messages]
        if (messages.length > 0) {
          // 替换最后一条消息的内容
          // 这是流式写入的核心：每次 chunk 到达都会调用此方法
          // 条件展开 sources：只有传入了 sources 才更新，避免覆盖已有数据
          messages[messages.length - 1] = {
            ...messages[messages.length - 1],
            content,
            ...(sources ? { sources } : {}),
          }
        }
        return { ...s, messages, updatedAt: Date.now() }
      })
      saveSessions(sessions)
      return { sessions }
    })
  },

  clearActiveMessages: () => {
    set((state) => {
      const sessions = state.sessions.map(s =>
        s.id === state.activeSessionId
          ? { ...s, messages: [], title: 'New Chat', updatedAt: Date.now() }
          : s
      )
      saveSessions(sessions)
      return { sessions }
    })
  },
}))
