/**
 * 运行时单例：把 Zotero 客户端、MinerU 客户端、文献库索引装配在一起。
 *
 * Host 半边的工具（给 Agent）和 HTTP 路由（给侧边栏面板）共用这一个实例，
 * 所以两边看到的是同一份索引、同一条「最近检索」轨迹，不会出现两个真相。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../core/library.ts'
import { MineruClient, MineruError, type MineruErrorKind } from '../core/mineru.ts'
import { ZoteroClient, ZoteroError } from '../core/zotero.ts'
import type { CitationFormat } from '../core/cite.ts'
import { formatCitationBundle, fallbackBibtex } from '../core/cite.ts'
import { describeExpansion, expandQuery } from '../core/glossary.ts'
import type { ParsedDocument, SearchHit, ZoteroItem } from '../core/types.ts'

export interface RuntimeConfig {
  dataDir?: string
  language?: string
  defaultTopK?: number
}

interface PersistedSettings {
  mineruToken?: string
  zoteroBaseUrl?: string
  zoteroStorageDir?: string
}

export interface TrailEntry {
  at: string
  source: 'tool' | 'panel'
  query: string
  itemKey: string | null
  topK: number
  hits: number
  chunkIds: string[]
}

export interface RuntimeStatus {
  dataDir: string
  zotero: { reachable: boolean; message: string }
  mineru: { configured: boolean; tokenSource: 'settings' | 'env' | 'none'; todayPages: number; tokenValid: boolean | null; tokenMessage: string }
  library: { items: number; parsedItems: number; chunks: number; metaChunks: number; builtAt: string | null }
}

const SETTINGS_FILE = 'settings.json'
const MAX_TRAIL = 40

export class Runtime {
  readonly dataDir: string
  readonly language: string
  readonly defaultTopK: number
  private settings: PersistedSettings = {
}
  private initPromise: Promise<void> | undefined
  private libraryPromise: Promise<Library> | undefined
  private trail: TrailEntry[] = []
  private zoteroClient: ZoteroClient | undefined

  constructor(config: RuntimeConfig = {}) {
    const configured = (config.dataDir ?? '').trim()
    this.dataDir = configured.length > 0
      ? configured
      : (process.env['ZOTEROSEEK_DATA'] ?? join(homedir(), '.zotero-seek'))
    this.language = (config.language ?? 'ch').trim() || 'ch'
    this.defaultTopK = clampNumber(config.defaultTopK, 1, 20, 8)
  }

  /** 幂等初始化：第一个调用者真正读盘，其余等待同一个 Promise。 */
  init(): Promise<void> {
    this.initPromise ??= this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    this.settings = await this.loadSettings()
  }

  // ------------------------------------------------------------- 装配

  zotero(): ZoteroClient {
    if (this.zoteroClient === undefined) {
      this.zoteroClient = new ZoteroClient({
        ...(this.settings.zoteroBaseUrl === undefined ? {} : { baseUrl: this.settings.zoteroBaseUrl }),
        ...(this.settings.zoteroStorageDir === undefined ? {} : { storageDir: this.settings.zoteroStorageDir }),
      })
    }
    return this.zoteroClient
  }

  /** token 优先级：插件设置里填的 > 环境变量 MINERU_TOKEN。 */
  mineruToken(): { token: string; source: 'settings' | 'env' | 'none' } {
    const fromSettings = (this.settings.mineruToken ?? '').trim()
    if (fromSettings.length > 0) return { token: fromSettings, source: 'settings' }
    const fromEnv = (process.env['MINERU_TOKEN'] ?? '').trim()
    if (fromEnv.length > 0) return { token: fromEnv, source: 'env' }
    return { token: '', source: 'none' }
  }

  mineru(): MineruClient {
    const { token } = this.mineruToken()
    return new MineruClient({ token, dataDir: this.dataDir, language: this.language })
  }

  library(): Promise<Library> {
    this.libraryPromise ??= Library.open(this.dataDir)
    return this.libraryPromise
  }

  // ------------------------------------------------------------- 操作

  async status(): Promise<RuntimeStatus> {
    const [library, zotero, mineru] = await Promise.all([this.library(), this.zotero().ping().catch((error: Error) => error), this.mineru()])
    const stats = library.stats()
    return {
      dataDir: this.dataDir,
      zotero: zotero instanceof Error
        ? { reachable: false, message: zotero.message }
        : { reachable: true, message: `Zotero 本地 API 可用（${zotero.apiVersion}）` },
      mineru: {
        configured: mineru.configured,
        tokenSource: this.mineruToken().source,
        todayPages: await mineru.todayPages(),
        // 每次状态查询都顺带验一次 token（不消耗额度），面板据此提示「token 失效」。
        tokenValid: this.mineruToken().source === 'none' ? null : (await mineru.checkToken()).valid,
        tokenMessage: this.mineruToken().source === 'none'
          ? '还没有配置 MinerU API Token'
          : (await mineru.checkToken()).message,
      },
      library: {
        items: stats.items,
        parsedItems: stats.parsedItems,
        chunks: stats.chunks,
        metaChunks: stats.metaChunks,
        builtAt: stats.builtAt,
      },
    }
  }

  /** 刷新条目元数据（从 Zotero）。 */
  async refresh(maxItems = 300): Promise<{ items: number }> {
    const library = await this.library()
    const result = await library.refreshItems(this.zotero(), { maxItems })
    return { items: result.items }
  }

  /** 面板左栏：条目列表（本地索引 + Zotero 元数据检索兜底）。 */
  async listItems(options: { query?: string; limit?: number } = {}): Promise<Array<ZoteroItem & { parsed: boolean }>> {
    const library = await this.library()
    if (library.items().length === 0) await this.refresh()
    const parsed = library.parsedItems()
    const query = (options.query ?? '').trim()
    const limit = clampNumber(options.limit, 1, 200, 100)
    let items: ZoteroItem[]
    if (query.length === 0) {
      items = library.items()
    } else {
      /**
       * 元数据打分而不是布尔过滤：
       * - 字面命中（标题/作者/期刊）权重 3，标签双向匹配（用户给条目打的「空洞」这类短标签，
       *   可能只是查询的一部分）权重 2；
       * - 再用领域双语词表把查询扩展成英文/中文术语，每个命中权重 1，累加而不是「命中一个就停」。
       * 这样「空洞病害」既能命中标题含 void 的，也能命中标签写着「空洞」的。
       */
      const scores = new Map<string, number>()
      const bump = (item: ZoteroItem, weight: number): void => {
        scores.set(item.key, (scores.get(item.key) ?? 0) + weight)
      }

      const lowered = query.toLowerCase()
      for (const item of library.items()) {
        const title = item.title.toLowerCase()
        const creators = item.creators.map((creator) => creator.toLowerCase())
        const journal = (item.publicationTitle ?? '').toLowerCase()
        if (title.includes(lowered) || creators.some((creator) => creator.includes(lowered)) || journal.includes(lowered)) {
          bump(item, 3)
        }
        for (const tag of item.tags) {
          const loweredTag = tag.toLowerCase()
          if (loweredTag.length === 0) continue
          if (loweredTag.includes(lowered) || lowered.includes(loweredTag)) bump(item, 2)
        }
      }

      const expansion = expandQuery(query)
      for (const { to } of expansion.added) {
        const needle = to.toLowerCase()
        for (const item of library.items()) {
          const hit = item.title.toLowerCase().includes(needle)
            || item.creators.some((creator) => creator.toLowerCase().includes(needle))
            || item.tags.some((tag) => tag.toLowerCase().includes(needle))
            || (item.publicationTitle ?? '').toLowerCase().includes(needle)
          if (hit) bump(item, 1)
        }
      }

      if (scores.size > 0) {
        items = library.items()
          .filter((item) => scores.has(item.key))
          .sort((left, right) => (scores.get(right.key) ?? 0) - (scores.get(left.key) ?? 0))
      } else {
        items = await this.zotero().searchItems(query, { limit })
        if (items.length === 0) {
          // 仍然为空时，用扩展后的英文词再问一次 Zotero（本地索引之外还有条目）。
          const translated = expansion.translatedQuery.trim()
          if (translated.length > 0) items = await this.zotero().searchItems(translated, { limit })
        }
      }
    }
    return items.slice(0, limit).map((item) => ({ ...item, parsed: parsed[item.key] !== undefined }))
  }

  /** 检索：词面 BM25 + 领域双语词表扩展，RRF 融合；没有命中时退回元数据检索。 */
  async search(query: string, options: {
    topK?: number
    itemKey?: string
    source?: 'tool' | 'panel'
    mode?: 'hybrid' | 'lexical'
    /** 同一问题的其它问法（最多 4 条），每路独立打分、同一片段取最高分。 */
    variants?: readonly string[]
  } = {}): Promise<{
    hits: SearchHit[]
    metadataOnly: ZoteroItem[]
    /** 跨语言扩展的解释；没有命中词表时为 null。 */
    expansion: { description: string; added: Array<{ from: string; to: string }> } | null
    mode: 'hybrid' | 'lexical'
    /** 扩展路准入摘要（覆盖率下限 / 分数余量 / 被拦下的片段数）。 */
    admission: { minCoverage: number; margin: number; candidates: number; admitted: number; rejected: number; gated: boolean } | null
    note?: string
  }> {
    const library = await this.library()
    const topK = clampNumber(options.topK, 1, 20, this.defaultTopK)
    const detail = library.searchDetailed(query, {
      topK,
      ...(options.itemKey === undefined ? {} : { itemKey: options.itemKey }),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.variants === undefined ? {} : { variants: options.variants }),
    })
    const hits = detail.hits
    const expansion = detail.expansion === null || detail.expansion.added.length === 0
      ? null
      : {
        description: describeExpansion(detail.expansion),
        added: detail.expansion.added.map((item) => ({ from: item.from, to: item.to })),
      }
    this.recordTrail({
      source: options.source ?? 'tool',
      query,
      itemKey: options.itemKey ?? null,
      topK,
      hits: hits.length,
      chunkIds: hits.map((hit) => hit.chunkId),
    })
    const admission = detail.admission === null
      ? null
      : {
        minCoverage: detail.admission.minCoverage,
        margin: detail.admission.margin,
        candidates: detail.admission.candidates,
        admitted: detail.admission.admitted,
        rejected: detail.admission.rejected,
        gated: detail.admission.gated,
      }
    if (hits.length > 0) return { hits, metadataOnly: [], expansion, mode: detail.mode, admission }
    // 检索不到时给「可能是你想找但还没入库的文献」，避免 Agent 直接编造。
    const metadataOnly = await this.zotero().searchItems(query, { limit: 5 }).catch(() => [])
    const parsed = library.parsedItems()
    const unindexed = metadataOnly.filter((item) => parsed[item.key] === undefined)
    return {
      hits,
      metadataOnly: unindexed,
      expansion,
      mode: detail.mode,
      admission,
      note: unindexed.length > 0
        ? '文献库里没有已入库正文命中；下面这些条目匹配元数据但还没入库，先调用 zotero_index 解析入库再检索。'
        : '文献库里没有相关内容（已入库文献的正文里没有匹配片段）。',
    }
  }

  /** MinerU 解析一篇文献并入库。 */
  async indexItem(itemKey: string): Promise<{ itemKey: string; title: string; chunks: number; source: string; dir: string; cached: boolean }> {
    const library = await this.library()
    const result = await library.ingest(this.zotero(), this.mineru(), itemKey)
    return {
      itemKey,
      title: result.item.title,
      chunks: result.chunks,
      source: result.source,
      dir: result.dir,
      cached: result.cached,
    }
  }

  /** 面板中栏：MinerU 转出的 Markdown 全文 + 该文献的分块概览。 */
  async markdown(itemKey: string): Promise<{
    item: ZoteroItem
    markdown: string
    parsed: ParsedDocument | null
    chunks: Array<{ chunkId: string; sectionPath: string; page: number | null; kind: string; tokens: number }>
    images: string[]
  } | null> {
    const library = await this.library()
    const item = (await this.zotero().getItem(itemKey)) ?? library.items().find((candidate) => candidate.key === itemKey) ?? null
    if (item === null) return null
    const parsed = library.parsedItems()[itemKey] ?? null
    if (parsed === null) {
      return { item, markdown: '', parsed: null, chunks: [], images: [] }
    }
    const markdown = await (await import('node:fs/promises')).readFile(parsed.markdownPath, 'utf8')
    const chunks = library.chunksOf(itemKey).map((chunk) => ({
      chunkId: chunk.chunkId,
      sectionPath: chunk.sectionPath,
      page: chunk.page,
      kind: chunk.kind,
      tokens: chunk.tokenEstimate,
    }))
    let images: string[] = []
    try {
      images = await this.mineru().listImages(parsed.dir)
    } catch {
      images = []
    }
    return { item, markdown, parsed, chunks, images }
  }

  async chunk(chunkId: string): Promise<{ chunk: import('../core/types.ts').Chunk; item: ZoteroItem | null } | null> {
    const library = await this.library()
    const chunk = library.getChunk(chunkId)
    if (chunk === null) return null
    const item = library.items().find((candidate) => candidate.key === chunk.itemKey) ?? null
    return { chunk, item }
  }

  /** 勾选引用：多条一次拼好。bibtex 优先用 Zotero 自己的导出。 */
  async cite(itemKeys: readonly string[], format: CitationFormat): Promise<Array<{ itemKey: string; text: string }>> {
    const library = await this.library()
    const items: ZoteroItem[] = []
    for (const key of itemKeys) {
      const item = (await this.zotero().getItem(key).catch(() => null))
        ?? library.items().find((candidate) => candidate.key === key)
        ?? null
      if (item !== null) items.push(item)
    }
    if (format !== 'bibtex') {
      const bundle = formatCitationBundle(items, format).split('\n')
      return items.map((item, index) => ({ itemKey: item.key, text: bundle[index] ?? '' }))
    }
    const out: Array<{ itemKey: string; text: string }> = []
    for (const item of items) {
      const fromZotero = await this.zotero().getBibtex(item.key).catch(() => null)
      out.push({ itemKey: item.key, text: fromZotero ?? fallbackBibtex(item) })
    }
    return out
  }

  parsedDocuments(): ParsedDocument[] {
    return Object.values(this.libraryCache()?.parsedItems() ?? {})
  }

  recentTrail(): TrailEntry[] {
    return this.trail
  }

  /** 保存 MinerU token（面板设置抽屉调用）；空字符串表示清除。 */
  async saveSettings(patch: PersistedSettings): Promise<{ mineruConfigured: boolean }> {
    const next: PersistedSettings = { ...this.settings }
    if (patch.mineruToken !== undefined) {
      const token = patch.mineruToken.trim()
      if (token.length === 0) delete next.mineruToken
      else next.mineruToken = token
    }
    if (patch.zoteroBaseUrl !== undefined) next.zoteroBaseUrl = patch.zoteroBaseUrl.trim() || undefined
    if (patch.zoteroStorageDir !== undefined) next.zoteroStorageDir = patch.zoteroStorageDir.trim() || undefined
    this.settings = next
    this.zoteroClient = undefined
    await writeFile(join(this.dataDir, SETTINGS_FILE), JSON.stringify(next, null, 2), 'utf8')
    return { mineruConfigured: this.mineruToken().source !== 'none' }
  }

  /** 把 MinerU/Zotero 的稳定错误翻成用户能看懂的中文句子。 */
  static describeError(error: unknown): { code: string; message: string } {
    if (error instanceof MineruError) return { code: `mineru/${error.kind satisfies MineruErrorKind}`, message: error.message }
    if (error instanceof ZoteroError) return { code: `zotero/${error.kind}`, message: error.message }
    const message = error instanceof Error ? error.message : String(error)
    return { code: 'unknown', message }
  }

  // ------------------------------------------------------------- internals

  private libraryCache(): Library | undefined {
    // 同步视角（面板轮询进度时用）。没加载过就返回空，避免把异步塞进同步方法。
    return (this as unknown as { loadedLibrary?: Library }).loadedLibrary
  }

  private recordTrail(entry: Omit<TrailEntry, 'at'>): void {
    this.trail.unshift({ at: new Date().toISOString(), ...entry })
    if (this.trail.length > MAX_TRAIL) this.trail.length = MAX_TRAIL
  }

  private async loadSettings(): Promise<PersistedSettings> {
    try {
      return JSON.parse(await readFile(join(this.dataDir, SETTINGS_FILE), 'utf8')) as PersistedSettings
    } catch {
      return {}
    }
  }
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}
