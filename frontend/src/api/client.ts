import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
})

export interface SearchResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export const apiClient = {
  health: () => api.get('/health'),

  library: () => api.get('/library'),

  search: (query: string, topK = 5) =>
    api.post<{ results: SearchResult[] }>('/search', { query, top_k: topK }),

  index: (pdfPath: string, itemId = 'manual', extractor = 'mineru') =>
    api.post('/index', { pdf_path: pdfPath, item_id: itemId, extractor }),

  chat: async (message: string, onChunk: (chunk: string) => void) => {
    const response = await fetch('/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value)
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') return
          onChunk(data)
        }
      }
    }
  },
}
