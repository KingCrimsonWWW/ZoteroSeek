/**
 * 面板的 HTTP 路由。
 *
 * 为什么走 HTTP 而不是 DSH 的 Remote/Typert：面板只是本插件的私有数据面，
 * a) 不需要为类型化 Remote 生成 schema；b) 面板与 Host 同一进程、同一套 TS 类型；
 * c) 图片等二进制直接用 Response 流出去。代价是路由不带 Peer 身份，所以它只
 * 绑定在 127.0.0.1 的 GUI 服务上，且只做只读 + 私有 token 写入。
 *
 * 路由前缀 `/zotero-seek`，全部返回 `{ok:true,value}` / `{ok:false,code,message}`。
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, normalize, resolve, sep } from 'node:path'
import { Runtime } from './runtime.ts'
import type { CitationFormat } from '../core/cite.ts'

const PREFIX = '/zotero-seek'
const MAX_BODY_BYTES = 64 * 1024

interface HostLike {
  webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  effect(callback: () => () => void, label?: string): unknown
}

export function registerPanelRoutes(ctx: HostLike, runtime: Runtime): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => handle(req, res, runtime),
  }), 'zotero-seek: panel routes')
}

async function handle(req: IncomingMessage, res: ServerResponse, runtime: Runtime): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const route = url.pathname.slice(PREFIX.length)
  try {
    await runtime.init()
    if (req.method === 'OPTIONS') return respond(res, 204, null)
    if (req.method === 'GET') {
      switch (route) {
        case '/api/status':
          return ok(res, await runtime.status())
        case '/api/library':
          return ok(res, await runtime.listItems({
            query: url.searchParams.get('query') ?? '',
            limit: Number(url.searchParams.get('limit') ?? 100),
          }))
        case '/api/search': {
          const query = (url.searchParams.get('q') ?? '').trim()
          if (query.length === 0) return fail(res, 400, 'empty-query', '检索词不能为空')
          const itemKey = url.searchParams.get('item_key')
          const mode = url.searchParams.get('mode') === 'lexical' ? 'lexical' as const : 'hybrid' as const
          return ok(res, await runtime.search(query, {
            topK: Number(url.searchParams.get('top_k') ?? runtime.defaultTopK),
            source: 'panel',
            mode,
            ...(itemKey === null || itemKey.length === 0 ? {} : { itemKey }),
          }))
        }
        case '/api/markdown': {
          const itemKey = url.searchParams.get('item_key') ?? ''
          const detail = await runtime.markdown(itemKey)
          if (detail === null) return fail(res, 404, 'item-not-found', `找不到条目 ${itemKey}`)
          return ok(res, detail)
        }
        case '/api/chunk': {
          const chunkId = url.searchParams.get('chunk_id') ?? ''
          const found = await runtime.chunk(chunkId)
          if (found === null) return fail(res, 404, 'chunk-not-found', `找不到片段 ${chunkId}`)
          return ok(res, found)
        }
        case '/api/item': {
          const key = url.searchParams.get('key') ?? ''
          if (key.length === 0) return fail(res, 400, 'invalid-args', 'key 必填')
          const item = await runtime.item(key)
          if (item === null) return fail(res, 404, 'item-not-found', `找不到条目 ${key}`)
          return ok(res, item)
        }
        case '/api/locate': {
          const itemKey = url.searchParams.get('item_key') ?? ''
          const excerpt = url.searchParams.get('q') ?? ''
          if (itemKey.length === 0 || excerpt.trim().length < 4) {
            return fail(res, 400, 'invalid-args', 'item_key 与 q（≥4 字）必填')
          }
          return ok(res, await runtime.locate(itemKey, excerpt.slice(0, 400)))
        }
        case '/api/cite': {
          const keys = (url.searchParams.get('item_keys') ?? '').split(',').map((key) => key.trim()).filter((key) => key.length > 0)
          const formatRaw = url.searchParams.get('format') ?? 'author-year'
          const formats: CitationFormat[] = ['author-year', 'numeric', 'reference', 'bibtex']
          const format = (formats as string[]).includes(formatRaw) ? formatRaw as CitationFormat : 'author-year'
          return ok(res, await runtime.cite(keys, format))
        }
        case '/api/trail':
          return ok(res, runtime.recentTrail())
        case '/file':
          return await serveFile(res, runtime, url)
        default:
          return fail(res, 404, 'not-found', `未知路由 ${route}`)
      }
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      switch (route) {
        case '/api/index': {
          const itemKey = String((body['item_key'] ?? '')).trim()
          if (itemKey.length === 0) return fail(res, 400, 'missing-item-key', '缺少 item_key')
          return ok(res, await runtime.indexItem(itemKey))
        }
        case '/api/refresh':
          return ok(res, await runtime.refresh())
        case '/api/settings':
          return ok(res, await runtime.saveSettings({
            ...(typeof body['mineruToken'] === 'string' ? { mineruToken: body['mineruToken'] } : {}),
            ...(typeof body['zoteroStorageDir'] === 'string' ? { zoteroStorageDir: body['zoteroStorageDir'] } : {}),
          }))
        default:
          return fail(res, 404, 'not-found', `未知路由 ${route}`)
      }
    }
    return fail(res, 405, 'method-not-allowed', `不支持 ${req.method ?? '未知方法'}`)
  } catch (error) {
    const described = Runtime.describeError(error)
    return fail(res, 500, described.code, described.message)
  }
}

/** 把解析产物目录里的图片发给面板；路径必须落在该文献的解析目录内。 */
async function serveFile(res: ServerResponse, runtime: Runtime, url: URL): Promise<void> {
  const itemKey = url.searchParams.get('item_key') ?? ''
  const relative = url.searchParams.get('path') ?? ''
  const library = await runtime.library()
  const parsed = library.parsedItems()[itemKey]
  if (parsed === undefined) return fail(res, 404, 'not-parsed', `条目 ${itemKey} 还没解析`)
  if (relative.length === 0 || isAbsolute(relative)) return fail(res, 400, 'bad-path', '非法路径')
  const root = resolve(parsed.dir)
  const target = normalize(resolve(root, relative))
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    return fail(res, 400, 'bad-path', '路径越出解析目录')
  }
  let bytes: Buffer
  try {
    bytes = await readFile(target)
  } catch {
    return fail(res, 404, 'file-not-found', `找不到文件 ${relative}`)
  }
  res.writeHead(200, {
    'content-type': mediaTypeOf(target),
    'content-length': String(bytes.byteLength),
    'cache-control': 'public, max-age=3600',
    ...corsHeaders(),
  })
  res.end(bytes)
}

function mediaTypeOf(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    case '.json': return 'application/json; charset=utf-8'
    case '.md': return 'text/markdown; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'x-content-type-options': 'nosniff',
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  const parsed = JSON.parse(raw) as unknown
  return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
}

function ok(res: ServerResponse, value: unknown): void {
  respond(res, 200, { ok: true, value })
}

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  respond(res, status, { ok: false, code, message })
}

function respond(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return
  if (payload === null) {
    res.writeHead(status, corsHeaders())
    res.end()
    return
  }
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    ...corsHeaders(),
  })
  res.end(body)
}
