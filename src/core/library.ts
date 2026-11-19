/**
 * 文献库：索引的持久化、增量入库、检索入口。
 *
 * 存储形态刻意选了「一个 JSON 快照 + 进程内 BM25」：
 * - 170 篇论文、几千个 chunk 的量级，JSON 几 MB，加载一次几十毫秒；
 * - 不引入 SQLite 原生模块（Electron 里 ABI 兼容是坑），也不引向量库；
 * - 索引是可读的，出问题能直接打开看，评测也能复现。
 * 规模再上一个量级时，换 SQLite FTS5 只改这一层。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Bm25Index, type Bm25Hit } from './bm25.ts'
import { expandQuery, type QueryExpansion } from './glossary.ts'
import { fuseRrf } from './rrf.ts'
import { blocksFromContentList, blocksFromMarkdown, buildChunks, estimateTokens } from './chunker.ts'
import type { MineruClient } from './mineru.ts'
import type { ZoteroClient } from './zotero.ts'
import type { Chunk, ContentBlock, LibraryIndex, ParsedDocument, SearchHit, ZoteroItem } from './types.ts'

const INDEX_FILE = 'index.json'

/** 检索模式：hybrid = 词面 + 双语词表扩展；lexical = 纯词面（评测基线）。 */
export type SearchMode = 'hybrid' | 'lexical'

export interface SearchOptions {
  topK?: number
  itemKey?: string
  maxCharsPerHit?: number
  mode?: SearchMode
}

export interface LibraryStats {
  items: number
  parsedItems: number
  /** 正文分块数（不含元数据块）。 */
  chunks: number
  /** 由条目元数据合成的块数（每个条目一块）。 */
  metaChunks: number
  builtAt: string | null
  dataDir: string
}

export interface IngestResult {
  item: ZoteroItem
  chunks: number
  cached: boolean
  /** 解析产物来源：MinerU 结构化块 / Markdown 兜底。 */
  source: 'content_list_v2' | 'content_list' | 'markdown'
  dir: string
}

/**
 * 把一条 Zotero 元数据压成可检索文本块。
 *
 * 「只要 Zotero 能拿到的信息都参与检索」：标题、作者、年份、期刊、标签、摘要、
 * extra（关键词/分区常写在这里）、DOI、citationKey。块 id 固定为 `<itemKey>:meta`，
 * 所以它在检索结果里同样可寻址、可被引用，但不会被误当成正文。
 */
export function buildMetadataChunk(item: ZoteroItem): Chunk {
  // 旧索引里的条目可能缺字段（例如早期版本没有 extra），这里一律防御式判断，
  // 避免「打开一个旧索引就崩」这类问题。
  const str = (value: unknown): string => (typeof value === 'string' && value.trim().length > 0 ? value : '')
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])
  const parts: string[] = [`标题：${str(item.title) || item.key}`]
  const creators = list(item.creators)
  if (creators.length > 0) parts.push(`作者：${creators.join('; ')}`)
  if (typeof item.year === 'number') parts.push(`年份：${item.year}`)
  const journal = str(item.publicationTitle)
  if (journal.length > 0) parts.push(`出版物：${journal}`)
  const tags = list(item.tags)
  if (tags.length > 0) parts.push(`标签：${tags.join('、')}`)
  const abstract = str(item.abstractNote)
  if (abstract.length > 0) parts.push(`摘要：${abstract}`)
  const extra = str(item.extra)
  if (extra.length > 0) parts.push(`补充信息：${extra}`)
  const doi = str(item.doi)
  if (doi.length > 0) parts.push(`DOI：${doi}`)
  const citationKey = str(item.citationKey)
  if (citationKey.length > 0) parts.push(`引用键：${citationKey}`)
  const text = parts.join('\n')
  return {
    chunkId: `${item.key}:meta`,
    itemKey: item.key,
    title: item.title,
    sectionPath: '元数据',
    page: null,
    kind: 'text',
    text,
    tokenEstimate: estimateTokens(text),
    source: 'meta',
  }
}

export class Library {
  private index: LibraryIndex
  private bm25: Bm25Index
  private queue: Promise<unknown> = Promise.resolve()
  private readonly dataDir: string

  private constructor(dataDir: string, index: LibraryIndex) {
    this.dataDir = dataDir
    this.index = index
    this.bm25 = new Bm25Index()
    this.rebuild()
  }

  static async open(dataDir: string): Promise<Library> {
    let index: LibraryIndex
    try {
      index = JSON.parse(await readFile(join(dataDir, INDEX_FILE), 'utf8')) as LibraryIndex
      if (index.version !== 1) index = emptyIndex()
    } catch {
      index = emptyIndex()
    }
    const library = new Library(dataDir, index)
    // 旧索引兼容：补齐后加字段（extra 等），再把元数据块补上并落盘
    const upgraded = library.upgradeStoredItems()
    if (upgraded || !library.index.chunks.some((chunk) => chunk.source === 'meta')) {
      if (library.index.items.length > 0) library.replaceMetaChunks()
      library.rebuild()
      await library.save()
    }
    return library
  }

  get root(): string {
    return this.dataDir
  }

  stats(): LibraryStats {
    const body = this.index.chunks.filter((chunk) => chunk.source !== 'meta')
    return {
      items: this.index.items.length,
      parsedItems: Object.keys(this.index.parsed).length,
      chunks: body.length,
      metaChunks: this.index.chunks.length - body.length,
      builtAt: this.index.builtAt.length > 0 ? this.index.builtAt : null,
      dataDir: this.dataDir,
    }
  }

  items(): ZoteroItem[] {
    return this.index.items
  }

  parsedItems(): Record<string, ParsedDocument> {
    return this.index.parsed
  }

  isParsed(itemKey: string): boolean {
    return this.index.parsed[itemKey] !== undefined
  }

  getChunk(chunkId: string): Chunk | null {
    return this.index.chunks.find((chunk) => chunk.chunkId === chunkId) ?? null
  }

  /** 只返回正文块；元数据块用 getChunk(${key}:meta) 单独取。 */
  chunksOf(itemKey: string): Chunk[] {
    return this.index.chunks.filter((chunk) => chunk.itemKey === itemKey && chunk.source !== 'meta')
  }

  /** 从 Zotero 刷新条目元数据（最多 maxItems 篇，按添加时间倒序更方便看新文献）。 */
  async refreshItems(zotero: ZoteroClient, options: { maxItems?: number } = {}): Promise<{ items: number; total: number | null }> {
    return this.serialize(async () => {
      const maxItems = Math.max(1, options.maxItems ?? 300)
      const collected: ZoteroItem[] = []
      let start = 0
      let total: number | null = null
      while (collected.length < maxItems) {
        const page = await zotero.listItems({
          limit: Math.min(100, maxItems - collected.length),
          start,
          sort: 'dateAdded',
          direction: 'desc',
        })
        if (total === null) total = page.total
        collected.push(...page.items)
        if (page.items.length < 100) break
        start += page.items.length
      }
      this.index.items = collected
      this.replaceMetaChunks()
      this.rebuild()
      this.index.builtAt = new Date().toISOString()
      await this.save()
      return { items: collected.length, total }
    })
  }

  /**
   * 入库一篇文献：MinerU 解析（内容寻址缓存）→ 结构化块 → chunk → 写索引。
   * 重复入库会替换该条目的旧 chunk，不会产生重复。
   */
  async ingest(zotero: ZoteroClient, mineru: MineruClient, itemKey: string): Promise<IngestResult> {
    return this.serialize(async () => {
      const item = await zotero.getItem(itemKey)
      if (item === null) {
        throw new Error(`Zotero 里找不到条目 ${itemKey}`)
      }
      const pdf = await zotero.resolvePdf(itemKey)
      if (pdf === null) {
        throw new Error(`条目 ${itemKey}（${item.title}）没有可用的 PDF 附件`)
      }
      const before = Object.keys(this.index.parsed).length
      const doc = await mineru.parse({ pdfPath: pdf.path, itemKey, title: item.title })
      const cached = Object.keys(this.index.parsed).length === before && this.index.parsed[itemKey] !== undefined
      const { blocks, source } = await readBlocks(doc)
      const chunks = buildChunks({ key: item.key, title: item.title }, blocks)
      this.index.chunks = this.index.chunks.filter((chunk) => chunk.itemKey !== itemKey)
      this.index.chunks.push(...chunks)
      this.index.parsed[itemKey] = doc
      if (!this.index.items.some((existing) => existing.key === itemKey)) this.index.items.push(item)
      this.upsertMetaChunk(item)
      const indexed = this.index.items.find((existing) => existing.key === itemKey)
      if (indexed !== undefined) {
        indexed.pdfAttachmentKey = pdf.attachmentKey
        indexed.pdfPath = pdf.path
      }
      this.index.builtAt = new Date().toISOString()
      this.rebuild()
      await this.save()
      return { item, chunks: chunks.length, cached, source, dir: doc.dir }
    })
  }

  /** 从索引里移除一篇文献（磁盘上的解析产物保留，方便复用缓存）。 */
  async forget(itemKey: string): Promise<boolean> {
    return this.serialize(async () => {
      const existed = this.index.parsed[itemKey] !== undefined || this.index.chunks.some((chunk) => chunk.itemKey === itemKey)
      delete this.index.parsed[itemKey]
      this.index.chunks = this.index.chunks.filter((chunk) => chunk.itemKey !== itemKey)
      this.rebuild()
      await this.save()
      return existed
    })
  }

  /**
   * 检索。默认混合模式：
   *   1. 原始查询走 BM25（词面）；
   *   2. 用领域双语词表扩展后的查询再走一次 BM25（跨语言）；
   *   3. 两路排名用 RRF 融合。
   * itemKey 存在时只在该文献内检索；mode='lexical' 可关闭扩展（评测基线用）。
   */
  search(query: string, options: SearchOptions = {}): SearchHit[] {
    return this.searchDetailed(query, options).hits
  }

  /** 与 search 相同，但额外返回扩展解释，供工具输出与面板展示。 */
  searchDetailed(query: string, options: SearchOptions = {}): {
    hits: SearchHit[]
    expansion: QueryExpansion | null
    mode: SearchMode
  } {
    const topK = Math.max(1, options.topK ?? 8)
    const mode: SearchMode = options.mode ?? 'hybrid'
    const maxChars = options.maxCharsPerHit ?? 1200
    const chunkById = new Map(this.index.chunks.map((chunk) => [chunk.chunkId, chunk]))
    const scoped = options.itemKey === undefined
      ? this.index.chunks
      : this.index.chunks.filter((chunk) => chunk.itemKey === options.itemKey)
    // 正文与元数据分开打分：正文是「回答问题」的主体，元数据是「发现条目」的补充。
    const candidates = scoped.filter((chunk) => chunk.source !== 'meta')
    const metaCandidates = scoped.filter((chunk) => chunk.source === 'meta')

    // 每路多取一些候选，融合后再截到 topK：RRF 需要看到两路的排名才有意义。
    const depth = Math.max(topK * 4, 20)
    const lexical = this.searchWithin(query, candidates, depth)
    const expansion = mode === 'hybrid' ? expandQuery(query) : null
    const expanded = expansion !== null && expansion.added.length > 0
      ? this.searchWithin(expansion.expandedQuery, candidates, depth)
      : []

    // 元数据只在两种情况下参与排序：
    // ① 查询很短（像关键词/标签检索）；② 正文两路都没有任何命中（正文里真没有）。
    // 注意不能用「命中不足 topK」当条件：中文问英文文献时词面那一路天然为空，
    // 那时扩展路已经能给出正文结果，再掺元数据只会把正文排名挤下去（评测里 MRR 会掉）。
    const shortQuery = query.trim().length <= 12
    const bodySignal = lexical.length + expanded.length
    const wantMeta = metaCandidates.length > 0 && (shortQuery || bodySignal === 0)

    const lexicalRank = new Map(lexical.map((hit, index) => [hit.id, index + 1]))
    const expandedRank = new Map(expanded.map((hit, index) => [hit.id, index + 1]))
    const metaHits = wantMeta
      ? this.searchWithin(expansion?.expandedQuery ?? query, metaCandidates, Math.max(topK, 6))
      : []
    const metaRank = new Map(metaHits.map((hit, index) => [hit.id, index + 1]))
    const matchedById = new Map<string, string[]>()
    for (const hit of [...lexical, ...expanded, ...metaHits]) {
      const existing = matchedById.get(hit.id) ?? []
      matchedById.set(hit.id, [...new Set([...existing, ...hit.matched])])
    }

    let ranked: Array<{ id: string; score: number; route: SearchHit['route'] }>
    if (expanded.length === 0 && metaHits.length === 0) {
      ranked = lexical.map((hit) => ({ id: hit.id, score: hit.score, route: 'lexical' as const }))
    } else {
      const lists: Array<{ ids: string[]; weight: number }> = [
        { ids: lexical.map((hit) => hit.id), weight: 1 },
      ]
      if (expanded.length > 0) lists.push({ ids: expanded.map((hit) => hit.id), weight: 0.9 })
      // 元数据路只在「短查询/正文不足」时参与；参与时权重与词面相同——
      // 用户搜一个标签词，就应该看到条目本身，而不是被正文片段淹没。
      if (metaHits.length > 0) lists.push({ ids: metaHits.map((hit) => hit.id), weight: 1 })
      const fused = fuseRrf(lists, { k: 10, topK })
      ranked = fused.map((hit) => ({
        id: hit.id,
        score: hit.score,
        route: lexicalRank.has(hit.id) && expandedRank.has(hit.id)
          ? 'both'
          : lexicalRank.has(hit.id) ? 'lexical'
            : expandedRank.has(hit.id) ? 'expanded' : 'lexical',
      }))
    }

    const hits = ranked.slice(0, topK).map((hit) => {
      const chunk = chunkById.get(hit.id)
      if (chunk === undefined) throw new Error(`索引不一致：chunk ${hit.id} 不存在`)
      return {
        chunkId: chunk.chunkId,
        itemKey: chunk.itemKey,
        title: chunk.title,
        sectionPath: chunk.sectionPath,
        page: chunk.page,
        kind: chunk.kind,
        text: chunk.text.length > maxChars ? `${chunk.text.slice(0, maxChars)}…` : chunk.text,
        score: Number(hit.score.toFixed(4)),
        route: hit.route,
        matched: matchedById.get(hit.id) ?? [],
        source: chunk.source ?? 'body',
        indexed: this.index.parsed[chunk.itemKey] !== undefined,
      }
    })
    return { hits, expansion, mode }
  }

  private searchWithin(
    query: string,
    candidates: readonly Chunk[],
    topK: number,
  ): Bm25Hit[] {
    if (candidates.length === this.index.chunks.length) {
      return this.bm25.search(query, topK)
    }
    // 单篇内检索：临时小索引，避免把过滤逻辑塞进 BM25 里。
    const scoped = new Bm25Index()
    scoped.build(candidates.map((chunk) => ({
      id: chunk.chunkId,
      title: chunk.title,
      section: chunk.sectionPath,
      text: chunk.text,
    })))
    return scoped.search(query, topK)
  }

  /** 按当前条目表重算全部元数据块（不动正文块）。 */
  private replaceMetaChunks(): void {
    const meta = this.index.items.map((item) => buildMetadataChunk(item))
    this.index.chunks = [...this.index.chunks.filter((chunk) => chunk.source !== 'meta'), ...meta]
  }

  /** 单条元数据块 upsert（入库新条目时用）。 */
  private upsertMetaChunk(item: ZoteroItem): void {
    this.index.chunks = this.index.chunks.filter((chunk) => chunk.chunkId !== `${item.key}:meta`)
    this.index.chunks.push(buildMetadataChunk(item))
  }

  /** 兼容旧索引：补齐后来新增的字段，返回是否有改动。 */
  private upgradeStoredItems(): boolean {
    let changed = false
    for (const item of this.index.items) {
      if (!Array.isArray(item.creators)) { item.creators = []; changed = true }
      if (!Array.isArray(item.tags)) { item.tags = []; changed = true }
      if (!Array.isArray(item.collections)) { item.collections = []; changed = true }
      if (item.extra === undefined) { item.extra = null; changed = true }
      if (item.abstractNote === undefined) { item.abstractNote = null; changed = true }
      if (item.publicationTitle === undefined) { item.publicationTitle = null; changed = true }
      if (item.doi === undefined) { item.doi = null; changed = true }
      if (item.citationKey === undefined) { item.citationKey = null; changed = true }
      if (item.year === undefined) { item.year = null; changed = true }
    }
    return changed
  }

  private rebuild(): void {
    this.bm25.build(this.index.chunks.map((chunk) => chunk.source === 'meta'
      // 元数据块正文里已包含标题，再按标题/章节加权会重复计分
      ? { id: chunk.chunkId, title: '', section: '', text: chunk.text }
      : { id: chunk.chunkId, title: chunk.title, section: chunk.sectionPath, text: chunk.text }))
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async save(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    const payload = JSON.stringify(this.index)
    const temp = join(this.dataDir, `${INDEX_FILE}.tmp`)
    await writeFile(temp, payload, 'utf8')
    await rename(temp, join(this.dataDir, INDEX_FILE))
  }
}

/** 读解析产物并归一化成内容块：优先按页分组的 v2，其次 v1，最后 Markdown。 */
export async function readBlocks(doc: ParsedDocument): Promise<{ blocks: ContentBlock[]; source: IngestResult['source'] }> {
  const v2 = join(doc.dir, 'content_list_v2.json')
  const v1 = join(doc.dir, 'content_list.json')
  const fromJson = async (path: string): Promise<ContentBlock[] | null> => {
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
      const blocks = blocksFromContentList(raw)
      return blocks.length === 0 ? null : blocks
    } catch {
      return null
    }
  }
  const v1Blocks = await fromJson(v1)
  if (v1Blocks !== null) return { blocks: v1Blocks, source: 'content_list' }
  const v2Blocks = await fromJson(v2)
  if (v2Blocks !== null) return { blocks: v2Blocks, source: 'content_list_v2' }
  const markdown = await readFile(doc.markdownPath, 'utf8')
  return { blocks: blocksFromMarkdown(markdown), source: 'markdown' }
}

function emptyIndex(): LibraryIndex {
  return { version: 1, builtAt: '', settingsFingerprint: '', items: [], parsed: {}, chunks: [] }
}
