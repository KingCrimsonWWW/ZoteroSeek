import { create } from 'zustand'
import { apiClient, type ChatSource } from '@/api/client'
import { useSessionStore } from './sessionStore'

interface ChatState {
  isLoading: boolean
  sendMessage: (content: string) => Promise<void>
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  isLoading: false,

  sendMessage: async (content: string) => {
    const sessionStore = useSessionStore.getState()

    // 添加用户消息
    sessionStore.addMessage({ role: 'user', content })
    // 添加 assistant 占位
    sessionStore.addMessage({ role: 'assistant', content: '' })
    set({ isLoading: true })

    let assistantContent = ''
    let sources: ChatSource[] | undefined

    try {
      await apiClient.chat(
        content,
        (chunk) => {
          assistantContent += chunk
          sessionStore.updateLastMessage(assistantContent, sources)
        },
        (src) => {
          sources = src
        },
      )
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败'
      assistantContent += `\n\n⚠️ ${errorMsg}`
    }

    // 最终更新
    sessionStore.updateLastMessage(assistantContent, sources)
    set({ isLoading: false })
  },

  clearMessages: () => {
    useSessionStore.getState().clearActiveMessages()
  },
}))
