import { create } from 'zustand'
import { apiClient, type ChatMessage } from '@/api/client'

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

    let assistantMessage = ''
    set({
      messages: [...get().messages, { role: 'assistant', content: '' }],
    })

    await apiClient.chat(content, (chunk) => {
      assistantMessage += chunk
      const msgs = get().messages
      msgs[msgs.length - 1] = { role: 'assistant', content: assistantMessage }
      set({ messages: [...msgs] })
    })

    set({ isLoading: false })
  },

  clearMessages: () => set({ messages: [] }),
}))
