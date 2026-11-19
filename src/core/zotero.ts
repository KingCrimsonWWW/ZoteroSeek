/**
 * Zotero 本地 API 客户端（只读）。
 *
 * 依据：本机 `zotero` skill 的 API 笔记（references/api-notes.md）与实测。
 * 关键事实，也是容易踩的坑：
 * - 读完不需要任何鉴权；库路径固定 `/api/users/0/...`（0 = 当前用户）；
 * - 条目响应是 `{ key, version, data, meta, links }`，真字段在 `data` 里；
 * - `q` 参数是「空格分词、全 AND 子串」匹配，不是语义检索 —— 所以真正的检索
 *   归我们自己的 BM25，Zotero 只做元数据检索；
 * - 附件的文件路径不在 JSON 里（有些库 `links` 直接是 null），必须按
 *   `<storage>/<attachmentKey>/<filename>` 拼，storage 根优先用 enclosure href 推断；
 * - 不要用 PowerShell 的 Invoke-WebRequest 访问它（HTTP/1.0 无 Content-Length
 *   会被 .NET 判成 ResponseEnded）；这里用 fetch 没有这个问题。
 */
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ZoteroCollection, ZoteroItem } from './types.ts'

export const DEFAULT_ZOTERO_BASE = 'http://127.0.0.1:23119'
/** 只把「文献条目」当文献；附件/笔记/批注不算。 */
const BIBLIO_TYPES = new Set([
  'journalArticle', 'thesis', 'book', 'bookSection', 'conferencePaper', 'document',
  'report', 'preprint', 'manuscript', 'newspaperArticle', 'magazineArticle',
])

export interface ZoteroClientOptions {
  /** 默认 http://127.0.0.1:23119 */
  baseUrl?: string
  /** Zotero 数据目录下的 storage 根；不填则自动推断。 */
  storageDir?: string
  timeoutMs?: number
}

export class ZoteroError extends Error {
  readonly kind: 'unreachable' | 'http' | 'not-found' | 'malformed'

  constructor(kind: ZoteroError['kind'], message: string) {
    super(message)
    this.name = 'ZoteroError'
    this.kind = kind
  }
}

interface RawCreator {
  creatorType?: string
  firstName?: string
  lastName?: string
  name?: string
}

interface RawItem {
  key: string
  version?: number
  data?: Record<string, unknown>
  meta?: { parsedDate?: string; numChildren?: number; creatorSummary?: string }
  links?: {
    enclosure?: { href?: string }
    attachment?: { href?: string; attachmentType?: string; attachmentSize?: number }
  } | null
}

export class ZoteroClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly configuredStorage: string | undefined
  private storageRootCache: string | undefined

  constructor(options: ZoteroClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_ZOTERO_BASE).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.configuredStorage = options.storageDir
  }

  get apiRoot(): string {
    return `${this.baseUrl}/api/users/0`
  }

  /** 连通性检查。返回 Zotero 版本信息，失败抛 ZoteroError。 */
  async ping(): Promise<{ reachable: true; apiVersion: string }> {
    // API 根在 `{base}/api/`（不是 /api/users/0/）；先探根拿版本头，
    // 拿不到就退而求证一次 items 列表，两者都 200 才算连通。
    try {
      const response = await fetch(`${this.baseUrl}/api/`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (response.ok) {
        return { reachable: true, apiVersion: response.headers.get('Zotero-API-Version') ?? 'unknown' }
      }
    } catch {
      // 继续走下面的兜底探测
    }
    const response = await this.request('/items?limit=1&format=json')
    return { reachable: true, apiVersion: response.headers.get('Zotero-API-Version') ?? 'unknown' }
  }

  /** 文献条目分页列表。不带 collectionKey 时给整库（top-level）。 */
  async listItems(options: {
    limit?: number
    start?: number
    itemType?: string
    collectionKey?: string
    sort?: string
    direction?: 'asc' | 'desc'
  } = {}): Promise<{ items: ZoteroItem[]; total: number | null }> {
    const limit = clamp(options.limit ?? 100, 1, 100)
    const start = Math.max(0, options.start ?? 0)
    const params = new URLSearchParams({
      limit: String(limit),
      start: String(start),
      format: 'json',
    })
    if (options.sort !== undefined) params.set('sort', options.sort)
    if (options.direction !== undefined) params.set('direction', options.direction)
    if (options.itemType !== undefined) params.set('itemType', options.itemType)

    const path = options.collectionKey === undefined
      ? `/items/top?${params.toString()}`
      : `/collections/${encodeURIComponent(options.collectionKey)}/items/top?${params.toString()}`
    const response = await this.request(path)
    const raw = (await response.json()) as RawItem[]
    const totalHeader = response.headers.get('Total-Results')
    const items = raw
      .filter((entry) => BIBLIO_TYPES.has(String(entry.data?.itemType ?? '')))
      .map((entry) => this.normalizeItem(entry))
    return { items, total: totalHeader === null ? null : Number(totalHeader) }
  }

  /** 用 Zotero 自己的元数据检索（全 AND 子串）。适合按标题/作者精确找。 */
  async searchItems(
    query: string,
    options: { limit?: number; mode?: 'titleCreatorYear' | 'everything' } = {},
  ): Promise<ZoteroItem[]> {
    const params = new URLSearchParams({
      q: query,
      qmode: options.mode ?? 'titleCreatorYear',
      limit: String(clamp(options.limit ?? 25, 1, 100)),
      format: 'json',
    })
    const response = await this.request(`/items?${params.toString()}`)
    const raw = (await response.json()) as RawItem[]
    const seen = new Set<string>()
    const items: ZoteroItem[] = []
    for (const entry of raw) {
      // mode=everything 搜的是附件全文，命中的可能是附件：升到父条目去重。
      const parent = typeof entry.data?.parentItem === 'string' ? entry.data.parentItem : null
      const key = parent ?? entry.key
      if (seen.has(key)) continue
      if (!BIBLIO_TYPES.has(String(entry.data?.itemType ?? '')) && parent === null) continue
      seen.add(key)
      if (parent !== null) {
        const resolved = await this.getRawItem(parent)
        if (resolved !== null) items.push(this.normalizeItem(resolved))
        continue
      }
      items.push(this.normalizeItem(entry))
    }
    return items
  }

  async getItem(key: string): Promise<ZoteroItem | null> {
    const raw = await this.getRawItem(key)
    return raw === null ? null : this.normalizeItem(raw)
  }

  /** 条目的子项（附件、笔记）。 */
  async getChildren(key: string): Promise<RawItem[]> {
    const response = await this.request(`/items/${encodeURIComponent(key)}/children?format=json`)
    return (await response.json()) as RawItem[]
  }

  /**
   * 解析条目的第一个 PDF 附件：返回附件 key 与磁盘绝对路径。
   * 找不到 PDF / 文件不在磁盘上时返回 null，并把原因交给调用方决定怎么显示。
   */
  async resolvePdf(itemKey: string): Promise<{ attachmentKey: string; path: string; filename: string } | null> {
    const children = await this.getChildren(itemKey)
    const pdf = children.find((child) => {
      const data = child.data ?? {}
      if (data.itemType !== 'attachment') return false
      const contentType = String(data.contentType ?? '')
      const filename = String(data.filename ?? '')
      return contentType === 'application/pdf' || /\.pdf$/i.test(filename)
    })
    if (pdf === undefined) return null

    const data = pdf.data ?? {}
    const filename = String(data.filename ?? '')
    if (filename.length === 0) return null
    const storage = await this.resolveStorageRoot(pdf)
    const path = join(storage, pdf.key, filename)
    try {
      await access(path)
    } catch {
      return null
    }
    return { attachmentKey: pdf.key, path, filename }
  }

  /** Zotero 自己抽取的 PDF 全文（纯文本流，表格结构会丢）。 */
  async getFulltext(attachmentKey: string): Promise<{ content: string; pages: number } | null> {
    try {
      const response = await this.request(`/items/${encodeURIComponent(attachmentKey)}/fulltext`)
      if (response.status === 404) return null
      const body = (await response.json()) as { content?: string; totalPages?: number; indexedPages?: number }
      if (typeof body.content !== 'string' || body.content.length === 0) return null
      return { content: body.content, pages: Number(body.totalPages ?? body.indexedPages ?? 0) }
    } catch (error) {
      if (error instanceof ZoteroError && error.kind === 'not-found') return null
      throw error
    }
  }

  /** 条目导出 BibTeX（本地 API 原生支持，避免自己拼转义）。 */
  async getBibtex(itemKey: string): Promise<string | null> {
    const response = await this.request(`/items/${encodeURIComponent(itemKey)}?format=bibtex`)
    const text = await response.text()
    return text.trim().length === 0 ? null : text
  }

  async listCollections(): Promise<ZoteroCollection[]> {
    const response = await this.request('/collections?format=json')
    const raw = (await response.json()) as RawItem[]
    return raw.map((entry) => ({
      key: entry.key,
      name: String(entry.data?.name ?? ''),
      parentKey: typeof entry.data?.parentCollection === 'string' ? entry.data.parentCollection : null,
      itemCount: Number(entry.meta?.numChildren ?? 0),
    }))
  }

  // ---------------------------------------------------------------- internals

  private async getRawItem(key: string): Promise<RawItem | null> {
    try {
      const response = await this.request(`/items/${encodeURIComponent(key)}?format=json`)
      return (await response.json()) as RawItem
    } catch (error) {
      if (error instanceof ZoteroError && error.kind === 'not-found') return null
      throw error
    }
  }

  /**
   * storage 根的三种来源，按可靠性排序：
   * 1. 显式配置；
   * 2. 附件 JSON 的 `links.enclosure.href`（file:///…/storage/<attKey>/<file>）取上两级；
   * 3. 平台默认 `~/Zotero/storage`。
   */
  private async resolveStorageRoot(attachment: RawItem): Promise<string> {
    if (this.configuredStorage !== undefined) return this.configuredStorage
    if (this.storageRootCache !== undefined) return this.storageRootCache
    const href = attachment.links?.enclosure?.href
    if (typeof href === 'string' && href.startsWith('file:///')) {
      const filePath = decodeURIComponent(href.replace(/^file:\/\/\//, ''))
      this.storageRootCache = dirname(dirname(filePath))
      return this.storageRootCache
    }
    this.storageRootCache = join(homedir(), 'Zotero', 'storage')
    return this.storageRootCache
  }

  private async request(path: string): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`${this.apiRoot}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new ZoteroError(
        'unreachable',
        `连不上 Zotero 本地 API（${this.baseUrl}）：确认 Zotero 已启动，且「设置 → 高级 → 允许此计算机上的其他应用程序与 Zotero 通信」已勾选。原始错误：${(error as Error).message}`,
      )
    }
    if (response.status === 404) throw new ZoteroError('not-found', `Zotero 返回 404：${path}`)
    if (!response.ok) {
      throw new ZoteroError('http', `Zotero 返回 HTTP ${response.status}：${path}`)
    }
    return response
  }

  private normalizeItem(raw: RawItem): ZoteroItem {
    const data = raw.data ?? {}
    const meta = raw.meta ?? {}
    const date = typeof data.date === 'string' ? data.date : null
    const parsedDate = typeof meta.parsedDate === 'string' ? meta.parsedDate : null
    const year = extractYear(parsedDate) ?? extractYear(date)
    return {
      key: raw.key,
      itemType: String(data.itemType ?? 'unknown'),
      title: String(data.title ?? '(无标题)'),
      creators: normalizeCreators(data.creators as RawCreator[] | undefined),
      year,
      date,
      doi: typeof data.DOI === 'string' ? data.DOI : null,
      citationKey: typeof data.citationKey === 'string' ? data.citationKey : null,
      publicationTitle: typeof data.publicationTitle === 'string'
        ? data.publicationTitle
        : typeof data.bookTitle === 'string' ? data.bookTitle : null,
      abstractNote: typeof data.abstractNote === 'string' ? data.abstractNote : null,
      extra: typeof data.extra === 'string' ? data.extra : null,
      tags: Array.isArray(data.tags)
        ? (data.tags as Array<{ tag?: string } | string>).map((tag) =>
          typeof tag === 'string' ? tag : String(tag.tag ?? ''))
          .filter((tag) => tag.length > 0)
        : [],
      collections: Array.isArray(data.collections) ? (data.collections as string[]) : [],
      pdfAttachmentKey: null,
      pdfPath: null,
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function extractYear(text: string | null): number | null {
  if (text === null) return null
  const match = /(1[5-9]\d{2}|20\d{2})/.exec(text)
  return match === null ? null : Number(match[1])
}

function normalizeCreators(creators: RawCreator[] | undefined): string[] {
  if (!Array.isArray(creators)) return []
  return creators
    .filter((creator) => creator.creatorType === undefined || creator.creatorType === 'author')
    .map((creator) => {
      if (typeof creator.name === 'string' && creator.name.length > 0) return creator.name
      const last = (creator.lastName ?? '').trim()
      const first = (creator.firstName ?? '').trim()
      if (last.length === 0 && first.length === 0) return ''
      if (last.length === 0) return first
      if (first.length === 0) return last
      return `${last}, ${first}`
    })
    .filter((name) => name.length > 0)
}
