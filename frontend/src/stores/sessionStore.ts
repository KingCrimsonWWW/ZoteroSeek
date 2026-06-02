import { create } from 'zustand'
import type { ChatMessage } from '@/api/client'

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

interface SessionState {
  sessions: ChatSession[]
  activeSessionId: string | null

  // 操作
  createSession: () => string
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  setActiveSession: (id: string) => void
  getActiveSession: () => ChatSession | null

  // 消息操作（作用于 active session）
  addMessage: (msg: ChatMessage) => void
  updateLastMessage: (content: string, sources?: ChatMessage['sources']) => void
  clearActiveMessages: () => void
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function generateTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (firstUser) {
    const text = firstUser.content.slice(0, 40)
    return text.length < firstUser.content.length ? text + '...' : text
  }
  return 'New Chat'
}

// 从 localStorage 加载
function loadSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem('zoteroseek-sessions')
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem('zoteroseek-sessions', JSON.stringify(sessions))
}

export const useSessionStore = create<SessionState>((set, get) => ({
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
      const activeSessionId = state.activeSessionId === id
        ? (sessions[0]?.id ?? null)
        : state.activeSessionId
      return { sessions, activeSessionId }
    })
  },

  renameSession: (id: string, title: string) => {
    set((state) => {
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
    const { sessions, activeSessionId } = get()
    return sessions.find(s => s.id === activeSessionId) ?? null
  },

  addMessage: (msg: ChatMessage) => {
    set((state) => {
      let { activeSessionId, sessions } = state

      // 如果没有活跃会话，自动创建
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
        const messages = [...s.messages, msg]
        return {
          ...s,
          messages,
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
