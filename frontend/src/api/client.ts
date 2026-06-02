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
  sources?: ChatSource[]
}

export interface ChatSource {
  index: number
  title: string
  section: string
  score: number
  content_preview: string
}

export interface ZoteroItem {
  key: string
  title: string
  item_type: string
  authors: string[]
  date: string
  abstract: string
  doi: string
  attachments: { key: string; filename: string; path: string; parent_key: string }[]
  indexed: boolean
}

export interface IndexResult {
  key: string
  title: string
  success: boolean
  chunks?: number
  error?: string
}

export const apiClient = {
  health: () => api.get('/health'),

  library: () => api.get('/library'),

  search: (query: string, topK = 5) =>
    api.post<{ results: SearchResult[] }>('/search', { query, top_k: topK }),

  index: (pdfPath: string, itemId = 'manual', extractor = 'mineru') =>
    api.post('/index', { pdf_path: pdfPath, item_id: itemId, extractor }),

  // Zotero 集成
  zoteroItems: () => api.get<{ items: ZoteroItem[]; total: number; pdf_count: number }>('/zotero-items'),

  indexZotero: (itemKeys?: string[], extractor = 'mineru') =>
    api.post<{ total: number; success: number; failed: number; results: IndexResult[] }>(
      '/index-zotero',
      { item_keys: itemKeys, extractor },
    ),

  chat: async (
    message: string,
    onChunk: (chunk: string) => void,
    onSources?: (sources: ChatSource[]) => void,
  ) => {
    const response = await fetch('/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') return
          onChunk(data)
        } else if (line.startsWith('sources: ')) {
          try {
            const sources = JSON.parse(line.slice(9))
            onSources?.(sources)
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  },
}
