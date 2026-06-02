import { create } from 'zustand'
import { apiClient, type ChatMessage, type ChatSource } from '@/api/client'

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  sendMessage: (content: string) => Promise<void>
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,

  sendMessage: async (content: string) => {
    const { messages } = get()
    set({
      messages: [...messages, { role: 'user', content }],
      isLoading: true,
    })

    let assistantContent = ''
    let sources: ChatSource[] | undefined
    set({
      messages: [...get().messages, { role: 'assistant', content: '' }],
    })

    try {
      await apiClient.chat(
        content,
        (chunk) => {
          assistantContent += chunk
          const msgs = get().messages
          msgs[msgs.length - 1] = { role: 'assistant', content: assistantContent, sources }
          set({ messages: [...msgs] })
        },
        (src) => {
          sources = src
        },
      )
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败'
      assistantContent += `\n\n⚠️ ${errorMsg}`
    }

    // 最终更新，附加 sources
    const msgs = get().messages
    msgs[msgs.length - 1] = { role: 'assistant', content: assistantContent, sources }
    set({ messages: [...msgs], isLoading: false })
  },

  clearMessages: () => set({ messages: [] }),
}))
