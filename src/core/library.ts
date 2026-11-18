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
import { Bm25Index } from './bm25.ts'
import { blocksFromContentList, blocksFromMarkdown, buildChunks } from './chunker.ts'
import type { MineruClient } from './mineru.ts'
import type { ZoteroClient } from './zotero.ts'
import type { Chunk, ContentBlock, LibraryIndex, ParsedDocument, SearchHit, ZoteroItem } from './types.ts'

const INDEX_FILE = 'index.json'

export interface LibraryStats {
  items: number
  parsedItems: number
  chunks: number
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
    return new Library(dataDir, index)
  }

  get root(): string {
    return this.dataDir
  }

  stats(): LibraryStats {
    return {
      items: this.index.items.length,
      parsedItems: Object.keys(this.index.parsed).length,
      chunks: this.index.chunks.length,
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

  chunksOf(itemKey: string): Chunk[] {
    return this.index.chunks.filter((chunk) => chunk.itemKey === itemKey)
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

  /** BM25 检索。itemKey 存在时只在该文献内检索。 */
  search(query: string, options: { topK?: number; itemKey?: string; maxCharsPerHit?: number } = {}): SearchHit[] {
    const topK = Math.max(1, options.topK ?? 8)
    const chunkById = new Map(this.index.chunks.map((chunk) => [chunk.chunkId, chunk]))
    const candidates = options.itemKey === undefined
      ? this.index.chunks
      : this.index.chunks.filter((chunk) => chunk.itemKey === options.itemKey)

    const hits = this.searchWithin(query, candidates, topK)
    const maxChars = options.maxCharsPerHit ?? 1200
    return hits.map((hit) => {
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
      }
    })
  }

  private searchWithin(
    query: string,
    candidates: readonly Chunk[],
    topK: number,
  ): Array<{ id: string; score: number }> {
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

  private rebuild(): void {
    this.bm25.build(this.index.chunks.map((chunk) => ({
      id: chunk.chunkId,
      title: chunk.title,
      section: chunk.sectionPath,
      text: chunk.text,
    })))
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
