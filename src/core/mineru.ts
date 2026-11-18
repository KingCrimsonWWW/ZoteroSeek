/**
 * MinerU 云端解析客户端（把 PDF 变成有版式的 Markdown）。
 *
 * 依据：本机 `mineru` skill 的实测结论（scripts/mparse.py 顶部注释）与官方文档。
 * 四步流程（实测，官方文档不全）：
 *   1. POST {base}/file-urls/batch  → { batch_id, file_urls[] }
 *   2. PUT  原始字节到 file_urls[0]（**不带 Content-Type**，上传即提交任务）
 *   3. GET  {base}/extract-results/batch/{batch_id} 轮询到 state ∈ {done, failed}
 *   4. GET  full_zip_url（无鉴权）→ 解压出 full.md / content_list_v2.json / images/
 *
 * 设计要点：
 * - 内容寻址缓存：目录名 = sha1(pdf 字节 + 解析参数)，同一份 PDF 换个 Zotero
 *   条目不会重复花钱；参数（backend/language/ocr/页码范围）变了才算新解析。
 * - 自带配额台账：MinerU 没有「查询剩余配额」接口，2000 页/天按北京时间重置，
 *   所以只能自己记账（记录在 mineru-ledger.json）。
 * - 失败分类：每个错误带稳定的 kind，UI/工具只按 kind 决定文案与重试策略。
 */
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { unzip } from './zip.ts'
import type { ParsedDocument } from './types.ts'

export type MineruErrorKind =
  | 'config'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'service_unavailable'
  | 'parse_failed'
  | 'unsupported_format'
  | 'network'

const ERROR_CODES: Record<string, { kind: MineruErrorKind; retryable: boolean }> = {
  A0202: { kind: 'auth', retryable: false },
  A0211: { kind: 'auth', retryable: false },
  '-60001': { kind: 'parse_failed', retryable: true },
  '-60002': { kind: 'unsupported_format', retryable: false },
  '-60003': { kind: 'parse_failed', retryable: false },
  '-60005': { kind: 'parse_failed', retryable: false },
  '-60006': { kind: 'parse_failed', retryable: false },
  '-60008': { kind: 'service_unavailable', retryable: true },
  '-60009': { kind: 'parse_failed', retryable: false },
  '-60010': { kind: 'parse_failed', retryable: false },
  '-60011': { kind: 'parse_failed', retryable: false },
  '-60012': { kind: 'parse_failed', retryable: false },
  '-60013': { kind: 'parse_failed', retryable: false },
  '-60014': { kind: 'parse_failed', retryable: false },
  '-60015': { kind: 'parse_failed', retryable: false },
  '-60016': { kind: 'parse_failed', retryable: false },
  '-60017': { kind: 'parse_failed', retryable: false },
  '-60018': { kind: 'quota', retryable: false },
}

export class MineruError extends Error {
  readonly kind: MineruErrorKind
  readonly retryable: boolean
  readonly code: string | undefined

  constructor(kind: MineruErrorKind, message: string, options: { retryable?: boolean; code?: string } = {}) {
    super(message)
    this.name = 'MineruError'
    this.kind = kind
    this.retryable = options.retryable ?? false
    this.code = options.code
  }
}

export interface MineruOptions {
  /** MinerU API Token；为空时任何解析都先报 config 错误。 */
  token: string
  /** 数据根目录：解析产物、缓存清单、配额台账都放这里。 */
  dataDir: string
  /** 默认 https://mineru.net/api/v4 */
  baseUrl?: string
  /** ch | en | ...，默认 ch（中英混排文献也建议 ch）。 */
  language?: string
  /** vlm（版面更好、通常更快）| pipeline（更确定、bbox 更干净） */
  modelVersion?: 'vlm' | 'pipeline'
  /** 页码范围，例 "1-3"；按切片计费。 */
  pageRanges?: string
  ocr?: boolean
  requestTimeoutMs?: number
  pollInitialMs?: number
  pollCapMs?: number
  pollMaxWaitMs?: number
}

export interface ParseRequest {
  pdfPath: string
  itemKey: string
  title?: string
  /** 忽略缓存强制重解析。 */
  force?: boolean
}

interface CacheManifest {
  /** fingerprint → 产物目录名 */
  [fingerprint: string]: { dirName: string; itemKey: string; parsedAt: string; estimatedPages: number }
}

interface Ledger {
  /** 'YYYY-MM-DD'（北京时间）→ 当天已用页数 */
  days: Record<string, number>
}

const PARSED_DIR = 'parsed'
const MANIFEST_FILE = 'mineru-manifest.json'
const LEDGER_FILE = 'mineru-ledger.json'

export class MineruClient {
  private readonly options: Required<Pick<MineruOptions, 'token' | 'dataDir' | 'baseUrl' | 'language' | 'modelVersion' | 'requestTimeoutMs' | 'pollInitialMs' | 'pollCapMs' | 'pollMaxWaitMs'>> & { pageRanges?: string; ocr?: boolean }

  constructor(options: MineruOptions) {
    this.options = {
      token: options.token.trim(),
      dataDir: options.dataDir,
      baseUrl: (options.baseUrl ?? 'https://mineru.net/api/v4').replace(/\/+$/, ''),
      language: options.language ?? 'ch',
      modelVersion: options.modelVersion ?? 'vlm',
      requestTimeoutMs: options.requestTimeoutMs ?? 600_000,
      pollInitialMs: options.pollInitialMs ?? 2_000,
      pollCapMs: options.pollCapMs ?? 20_000,
      pollMaxWaitMs: options.pollMaxWaitMs ?? 1_800_000,
      ...(options.pageRanges === undefined ? {} : { pageRanges: options.pageRanges }),
      ...(options.ocr === undefined ? {} : { ocr: options.ocr }),
    }
  }

  get configured(): boolean {
    return this.options.token.length > 0
  }

  get parsedRoot(): string {
    return join(this.options.dataDir, PARSED_DIR)
  }

  /** 解析一份 PDF，命中缓存则直接返回（不产生 MinerU 调用）。 */
  async parse(request: ParseRequest): Promise<ParsedDocument> {
    if (!this.configured) {
      throw new MineruError('config', '还没有配置 MinerU API Token。请在插件设置里填入 token（mineru.net 用户中心 → API 管理）。')
    }
    const bytes = new Uint8Array(await readFile(request.pdfPath))
    const sourceSha1 = sha1(bytes)
    const settingsFingerprint = this.settingsFingerprint(sourceSha1)
    const dirName = sha1(new TextEncoder().encode(settingsFingerprint)).slice(0, 16)
    const dir = join(this.parsedRoot, dirName)

    if (request.force !== true) {
      const cached = await this.readParsed(dir)
      if (cached !== null) return cached
    }

    const estimate = estimatePdfPages(bytes)
    const zipUrl = await this.submitAndWait(bytes, basename(request.pdfPath), request.itemKey)
    await this.downloadAndExtract(zipUrl, dir, {
      itemKey: request.itemKey,
      sourceSha1,
      settingsFingerprint,
      estimatedPages: estimate,
    })

    const doc = await this.readParsed(dir)
    if (doc === null) {
      throw new MineruError('parse_failed', '解析产物不完整（缺少 full.md 或 meta.json），已保留目录供排查。')
    }
    await this.recordUsage(dirName, request.itemKey, estimate, doc.parsedAt)
    return doc
  }

  /** 读全文 Markdown；未解析时返回 null。 */
  async readMarkdown(itemKey: string): Promise<{ dir: string; markdown: string } | null> {
    const manifest = await this.readManifest()
    for (const entry of Object.values(manifest)) {
      if (entry.itemKey !== itemKey) continue
      const dir = join(this.parsedRoot, entry.dirName)
      try {
        const markdown = await readFile(join(dir, 'full.md'), 'utf8')
        return { dir, markdown }
      } catch {
        continue
      }
    }
    return null
  }

  /** 列出所有已解析文档（按解析时间倒序）。 */
  async listParsed(): Promise<Array<ParsedDocument & { dirName: string }>> {
    const manifest = await this.readManifest()
    const out: Array<ParsedDocument & { dirName: string }> = []
    for (const entry of Object.values(manifest)) {
      const dir = join(this.parsedRoot, entry.dirName)
      const doc = await this.readParsed(dir)
      if (doc !== null) out.push({ ...doc, dirName: entry.dirName })
    }
    return out.sort((left, right) => right.parsedAt.localeCompare(left.parsedAt))
  }

  /** 今天（北京时间）已用页数，来自本地台账。 */
  async todayPages(): Promise<number> {
    const ledger = await this.readLedger()
    return ledger.days[todayInBeijing()] ?? 0
  }

  /**
   * 校验 token 是否可用。刻意查一个不存在的批次号：
   * token 无效会返回 A0211/A0202，token 有效则返回「批次不存在」这类业务错误，
   * 两种都不消耗页数额度。
   */
  async checkToken(): Promise<{ valid: boolean; message: string }> {
    if (!this.configured) return { valid: false, message: '还没有配置 MinerU API Token' }
    try {
      const payload = await this.apiJson('/extract-results/batch/token-probe-does-not-exist', { method: 'GET' })
      return { valid: true, message: `token 可用（MinerU 返回业务错误码 ${String(payload['code'] ?? '?')}，不消耗额度）` }
    } catch (error) {
      // 401/403 才是 token 问题；服务端回了业务错误码（例如 -60012 task not found），
      // 说明鉴权已经通过，token 本身可用。
      if (error instanceof MineruError && error.kind === 'auth') return { valid: false, message: error.message }
      if (error instanceof MineruError && error.kind !== 'network' && error.kind !== 'service_unavailable') {
        return { valid: true, message: `token 可用（MinerU 返回业务错误码 ${error.code ?? error.kind}，不消耗额度）` }
      }
      return { valid: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  // ---------------------------------------------------------------- internals

  private settingsFingerprint(sourceSha1: string): string {
    const settings = {
      sha1: sourceSha1,
      modelVersion: this.options.modelVersion,
      language: this.options.language,
      ocr: this.options.ocr ?? false,
      pageRanges: this.options.pageRanges ?? null,
    }
    return JSON.stringify(settings)
  }

  private requestBody(fileName: string, itemKey: string): Record<string, unknown> {
    // 注意：page_ranges / is_ocr 属于 files[] 内的单文件参数，不是顶层参数
    // （官方参数表与参考实现都这么放；放顶层会被忽略并导致整篇计费）。
    const file: Record<string, unknown> = {
      name: fileName,
      data_id: itemKey.replace(/[^A-Za-z0-9]/g, ''),
    }
    if (this.options.pageRanges !== undefined) file.page_ranges = this.options.pageRanges
    if (this.options.ocr === true) file.is_ocr = true
    return {
      files: [file],
      model_version: this.options.modelVersion,
      language: this.options.language,
      enable_formula: true,
      enable_table: true,
    }
  }

  private async submitAndWait(bytes: Uint8Array, fileName: string, itemKey: string): Promise<string> {
    const created = await this.apiJson('/file-urls/batch', {
      method: 'POST',
      body: this.requestBody(fileName, itemKey),
    })
    const data = created['data'] as { batch_id?: string; file_urls?: string[] } | undefined
    const batchId = data?.batch_id
    const uploadUrl = data?.file_urls?.[0]
    if (typeof batchId !== 'string' || typeof uploadUrl !== 'string') {
      throw new MineruError('service_unavailable', `创建解析任务失败，响应缺少 batch_id/file_urls：${JSON.stringify(created).slice(0, 300)}`)
    }

    // PUT 原始字节：presigned URL 自带鉴权，且**不能**带 Content-Type，否则签名失配。
    let uploadResponse: Response
    try {
      uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytes as unknown as BodyInit,
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      })
    } catch (error) {
      throw new MineruError('network', `上传 PDF 失败：${(error as Error).message}`, { retryable: true })
    }
    if (!uploadResponse.ok) {
      throw new MineruError('service_unavailable', `上传 PDF 返回 HTTP ${uploadResponse.status}`, { retryable: true })
    }

    const startedAt = Date.now()
    let delay = this.options.pollInitialMs
    for (;;) {
      const result = await this.apiJson(`/extract-results/batch/${batchId}`, { method: 'GET' })
      const rows = (result['data'] as { extract_result?: Array<Record<string, unknown>> } | undefined)?.extract_result ?? []
      const first = rows[0]
      if (first === undefined) {
        throw new MineruError('parse_failed', '解析结果为空（extract_result 缺失）。')
      }
      const state = String(first['state'] ?? '')
      if (state === 'done') {
        const zipUrl = first['full_zip_url']
        if (typeof zipUrl !== 'string' || zipUrl.length === 0) {
          throw new MineruError('parse_failed', '解析完成但没有 full_zip_url。')
        }
        return zipUrl
      }
      if (state === 'failed') {
        throw new MineruError('parse_failed', `MinerU 解析失败：${String(first['err_msg'] ?? '未知原因')}`)
      }
      if (Date.now() - startedAt > this.options.pollMaxWaitMs) {
        throw new MineruError('service_unavailable', '等待 MinerU 解析超时（10 分钟）。', { retryable: true })
      }
      await sleep(delay)
      delay = Math.min(Math.round(delay * 1.5), this.options.pollCapMs)
    }
  }

  private async downloadAndExtract(
    zipUrl: string,
    dir: string,
    meta: { itemKey: string; sourceSha1: string; settingsFingerprint: string; estimatedPages: number },
  ): Promise<void> {
    let response: Response
    try {
      response = await fetch(zipUrl, { signal: AbortSignal.timeout(this.options.requestTimeoutMs) })
    } catch (error) {
      throw new MineruError('network', `下载解析结果失败：${(error as Error).message}`, { retryable: true })
    }
    if (!response.ok) {
      throw new MineruError('service_unavailable', `下载解析结果返回 HTTP ${response.status}`, { retryable: true })
    }
    const archive = new Uint8Array(await response.arrayBuffer())
    const files = unzip(archive)

    const staging = `${dir}.tmp-${Date.now()}`
    await mkdir(join(staging, 'images'), { recursive: true })
    await mkdir(join(staging, 'extras'), { recursive: true })

    for (const [name, data] of files) {
      const fileName = basename(name)
      if (name.startsWith('images/')) {
        await writeFile(join(staging, 'images', fileName), data)
        continue
      }
      if (name === 'full.md' || fileName === 'full.md') {
        await writeFile(join(staging, 'full.md'), data)
        continue
      }
      if (fileName.endsWith('content_list_v2.json')) {
        await writeFile(join(staging, 'content_list_v2.json'), data)
        continue
      }
      if (fileName.endsWith('content_list.json')) {
        await writeFile(join(staging, 'content_list.json'), data)
        continue
      }
      if (fileName === 'layout.json') {
        await writeFile(join(staging, 'layout.json'), data)
        continue
      }
      if (fileName.endsWith('.pdf')) continue // 原 PDF 已经在 Zotero 里，不重复存
      if (fileName.endsWith('.md')) {
        await writeFile(join(staging, 'extras', fileName), data)
        continue
      }
      await writeFile(join(staging, 'extras', fileName), data)
    }

    const metaRecord = {
      itemKey: meta.itemKey,
      sourceSha1: meta.sourceSha1,
      settingsFingerprint: meta.settingsFingerprint,
      backend: this.options.modelVersion,
      language: this.options.language,
      pageRanges: this.options.pageRanges ?? null,
      estimatedPages: meta.estimatedPages,
      parsedAt: new Date().toISOString(),
    }
    await writeFile(join(staging, 'meta.json'), JSON.stringify(metaRecord, null, 2), 'utf8')

    // 原子替换：先写临时目录，再改名，避免半成品被当成缓存命中。
    await mkdir(this.parsedRoot, { recursive: true })
    await rmRecursive(dir)
    await rename(staging, dir)
  }

  private async readParsed(dir: string): Promise<ParsedDocument | null> {
    try {
      const [markdown, metaRaw] = await Promise.all([
        readFile(join(dir, 'full.md'), 'utf8'),
        readFile(join(dir, 'meta.json'), 'utf8'),
      ])
      const meta = JSON.parse(metaRaw) as { itemKey?: string; parsedAt?: string; estimatedPages?: number; settingsFingerprint?: string }
      if (markdown.trim().length === 0) return null
      return {
        itemKey: String(meta.itemKey ?? ''),
        dir,
        markdownPath: join(dir, 'full.md'),
        pageCount: typeof meta.estimatedPages === 'number' ? meta.estimatedPages : null,
        parsedAt: String(meta.parsedAt ?? new Date(0).toISOString()),
        fingerprint: String(meta.settingsFingerprint ?? ''),
      }
    } catch {
      return null
    }
  }

  private async apiJson(path: string, init: { method: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetch(`${this.options.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      })
    } catch (error) {
      throw new MineruError('network', `MinerU 请求失败（${path}）：${(error as Error).message}`, { retryable: true })
    }
    if (response.status === 401 || response.status === 403) {
      throw new MineruError('auth', `MinerU 拒绝了当前 Token（HTTP ${response.status}）。请到 mineru.net 用户中心刷新 token 后重新填入插件设置。`, { retryable: false })
    }
    if (response.status === 429) {
      throw new MineruError('rate_limited', 'MinerU 限流（HTTP 429），稍后再试。', { retryable: true })
    }
    if (!response.ok) {
      throw new MineruError('service_unavailable', `MinerU 返回 HTTP ${response.status}（${path}）`, { retryable: response.status >= 500 })
    }
    const text = await response.text()
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new MineruError('service_unavailable', `MinerU 返回非 JSON：${text.slice(0, 200)}`, { retryable: true })
    }
    const code = payload['code']
    if (code !== 0 && code !== '0') {
      const codeText = String(code ?? '')
      const mapped = ERROR_CODES[codeText]
      const kind = mapped?.kind ?? 'service_unavailable'
      const message = String(payload['msg'] ?? '未知错误')
      if (codeText === 'A0211' || codeText === 'A0202') {
        throw new MineruError('auth', `MinerU Token 失效（${codeText}: ${message}）。请到 mineru.net 用户中心刷新 token 后重新填入插件设置。`, { code: codeText })
      }
      throw new MineruError(kind, `MinerU 返回错误 ${codeText}：${message}`, {
        retryable: mapped?.retryable ?? false,
        code: codeText,
      })
    }
    return payload
  }

  private async readManifest(): Promise<CacheManifest> {
    try {
      return JSON.parse(await readFile(join(this.options.dataDir, MANIFEST_FILE), 'utf8')) as CacheManifest
    } catch {
      return {}
    }
  }

  private async recordUsage(dirName: string, itemKey: string, estimatedPages: number, parsedAt: string): Promise<void> {
    await mkdir(this.options.dataDir, { recursive: true })
    const manifest = await this.readManifest()
    manifest[dirName] = { dirName, itemKey, parsedAt, estimatedPages }
    await writeFile(join(this.options.dataDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8')

    const ledger = await this.readLedger()
    const day = todayInBeijing()
    ledger.days[day] = (ledger.days[day] ?? 0) + estimatedPages
    await writeFile(join(this.options.dataDir, LEDGER_FILE), JSON.stringify(ledger, null, 2), 'utf8')
  }

  private async readLedger(): Promise<Ledger> {
    try {
      return JSON.parse(await readFile(join(this.options.dataDir, LEDGER_FILE), 'utf8')) as Ledger
    } catch {
      return { days: {} }
    }
  }

  /** 供 Host 侧注册图片静态路由时用：列出一个解析目录下的图片相对路径。 */
  async listImages(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(join(dir, 'images'))
      return entries.filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
    } catch {
      return []
    }
  }
}

function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 粗略估页数（用于本地配额台账，不追求精确）。 */
function estimatePdfPages(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes)
  const counted = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
  if (counted > 0) return counted
  const declared = /\/Count\s+(\d+)/.exec(text)
  return declared === null ? 0 : Number(declared[1])
}

/** MinerU 配额按北京时间 00:00 重置。 */
export function todayInBeijing(now: Date = new Date()): string {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return beijing.toISOString().slice(0, 10)
}

async function rmRecursive(path: string): Promise<void> {
  try {
    await access(dirname(path))
  } catch {
    return
  }
  const { rm } = await import('node:fs/promises')
  await rm(path, { recursive: true, force: true })
}
