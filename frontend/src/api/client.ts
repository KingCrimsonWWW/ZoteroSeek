/**
 * API Client — 统一的后端通信层
 *
 * 设计思路：
 * 本文件封装了所有与后端 API 的通信逻辑。采用"双引擎"策略：
 * - 普通请求（GET/POST）：使用 axios，享受拦截器、自动 JSON 解析等便利
 * - 流式请求（chat SSE）：使用原生 fetch API 的 ReadableStream
 *
 * 为什么 chat 接口不用 axios 而用 fetch：
 * - axios 的 response interceptor 会等待整个响应体接收完毕才返回，
 *   无法处理 Server-Sent Events (SSE) 这种逐 chunk 推送的场景
 * - 原生 fetch 的 response.body.getReader() 提供了 ReadableStream 接口，
 *   可以逐块读取数据，实现流式打字机效果
 * - 对于普通 API 调用，axios 的便利性（拦截器、类型推导、错误处理）更有优势
 */
import axios from 'axios'

// axios 实例，配置统一的 baseURL 前缀
// 所有通过此实例发起的请求都会自动加上 /api/v1 前缀
// Vite 开发服务器的 proxy 配置会将其转发到后端服务
const api = axios.create({
  baseURL: '/api/v1',
})

/** 搜索结果的单条记录 */
export interface SearchResult {
  /** 向量数据库中的唯一标识 */
  id: string
  /** 文本内容 */
  content: string
  /** 元数据（如来源文件名、页码等） */
  metadata: Record<string, unknown>
  /** 向量相似度分数，范围 0-1，越高越相关 */
  score: number
}

/** 聊天消息结构 */
export interface ChatMessage {
  /** 角色：用户输入或 AI 回复 */
  role: 'user' | 'assistant'
  /** 消息文本内容 */
  content: string
  /** AI 回复的引用源列表（仅 assistant 消息有此字段） */
  sources?: ChatSource[]
}

/** AI 回复中引用的文献来源 */
export interface ChatSource {
  /** 来源编号（如 [1]、[2]），用于消息正文中交叉引用 */
  index: number
  /** 论文/文档标题 */
  title: string
  /** 论文章节名 */
  section: string
  /** 相关度评分 */
  score: number
  /** 内容摘要预览（截取片段） */
  content_preview: string
}

/** Zotero 文献库中的条目 */
export interface ZoteroItem {
  /** Zotero 内部标识符 */
  key: string
  /** 文献标题 */
  title: string
  /** 条目类型（journalArticle, book, conferencePaper 等） */
  item_type: string
  /** 作者列表 */
  authors: string[]
  /** 发表日期 */
  date: string
  /** 摘要 */
  abstract: string
  /** 数字对象标识符 */
  doi: string
  /** PDF 附件列表 */
  attachments: { key: string; filename: string; path: string; parent_key: string }[]
  /** 是否已被索引到向量数据库中 */
  indexed: boolean
}

/** 单篇文献的索引结果 */
export interface IndexResult {
  key: string
  title: string
  /** 是否索引成功 */
  success: boolean
  /** 分块数量（仅成功时有值） */
  chunks?: number
  /** 错误信息（仅失败时有值） */
  error?: string
}

/**
 * 统一的 API 客户端对象
 * 采用对象字面量而非 class，因为这些方法之间没有共享状态，
 * 纯函数式的组织方式更简洁
 */
export const apiClient = {
  /** 健康检查：验证后端服务是否存活 */
  health: () => api.get('/health'),

  /** 获取文献库完整列表 */
  library: () => api.get('/library'),

  /** 语义搜索：将查询文本向量化后在向量数据库中检索相似片段 */
  search: (query: string, topK = 5) =>
    api.post<{ results: SearchResult[] }>('/search', { query, top_k: topK }),

  /** 索引单个 PDF 文件：解析 -> 分块 -> 向量化 -> 存储 */
  index: (pdfPath: string, itemId = 'manual', extractor = 'mineru') =>
    api.post('/index', { pdf_path: pdfPath, item_id: itemId, extractor }),

  /**
   * 获取 Zotero 文献库条目列表
   * 包含总数和 PDF 附件数量等统计信息
   */
  zoteroItems: () => api.get<{ items: ZoteroItem[]; total: number; pdf_count: number }>('/zotero-items'),

  /** 批量索引 Zotero 中的文献（可指定条目或索引全部） */
  indexZotero: (itemKeys?: string[], extractor = 'mineru') =>
    api.post<{ total: number; success: number; failed: number; results: IndexResult[] }>(
      '/index-zotero',
      { item_keys: itemKeys, extractor },
    ),

  /**
   * 聊天接口 —— SSE 流式请求
   *
   * 协议格式：
   * 后端以 SSE (Server-Sent Events) 格式返回数据，每行一个事件：
   *   data: <文本片段>      —— AI 回复的一个 chunk
   *   sources: <JSON 数组>  —— 流末尾发送的引用源元数据
   *   data: [DONE]          —— 流结束标记
   *
   * 为什么用回调函数而不是返回 AsyncGenerator：
   * - 回调方式更容易与 Zustand store 集成（在回调中直接更新状态）
   * - AsyncGenerator 虽然更"函数式"，但在 React 组件中消费时需要额外的
   *   useEffect + 循环逻辑，增加了复杂度
   */
  chat: async (
    message: string,
    /** 每收到一个文本 chunk 时触发 */
    onChunk: (chunk: string) => void,
    /** 收到引用源元数据时触发（在流末尾，仅一次） */
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

    // 获取 ReadableStream 的读取器，用于逐块读取响应体
    const reader = response.body?.getReader()
    if (!reader) return

    // TextDecoder 用于将 Uint8Array（二进制）解码为 UTF-8 字符串
    const decoder = new TextDecoder()

    // buffer 用于处理跨 chunk 边界的不完整行
    // 因为 TCP 分包不保证按行切割，一个 chunk 可能包含半行数据
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // stream: true 告诉 decoder 还有后续数据，不要立即 flush 缓冲区
      // 这对于多字节 UTF-8 字符（如中文）跨 chunk 分割的场景很重要
      buffer += decoder.decode(value, { stream: true })

      // 按换行符分割，最后一段可能是不完整的行，放回 buffer 等待下次拼接
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      // 解析每一行的 SSE 协议
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          // 标准 SSE 数据行：提取 "data: " 之后的内容
          const data = line.slice(6)
          // [DONE] 是 SSE 流的结束标记
          if (data === '[DONE]') return
          onChunk(data)
        } else if (line.startsWith('sources: ')) {
          // 自定义协议：后端在流末尾发送 JSON 格式的引用源列表
          // 这不是标准 SSE 字段，是项目自定义的扩展协议
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
