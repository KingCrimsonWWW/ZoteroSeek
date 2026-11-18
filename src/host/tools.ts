/**
 * Host 半边的工具定义（Agent 在对话里调用）。
 *
 * 说明两个刻意的设计：
 * 1. 不 import `@deepseek-ai/dsh-tools` 的 `defineTool`：插件是本地目录安装的，
 *    宿主包解析不保证可用；注册所需的 ToolDefinition 是纯 JSON 结构，手写即可，
 *    这样 bundle 零依赖。参数 Schema 用宿主支持的 JSON Schema 子集
 *    （object/properties/required/additionalProperties + 标量/数组）。
 * 2. 工具结果同时返回「给模型读的文本」和「结构化值」：文本里每条命中都带
 *    chunk_id、标题、章节路径、页码，模型引用时只能抄这些真实存在的 id，
 *    评测脚本就能事后核对引用是否落在本轮检索结果里。
 */
import { Runtime } from './runtime.ts'
import type { EvalDeps } from './eval-runner.ts'
import { runEvalOnDisk } from './eval-runner.ts'
import type { CitationFormat } from '../core/cite.ts'

/** 与 @deepseek-ai/dsh-tools 的 ToolDefinition 对齐的最小结构（无类型依赖）。 */
export interface HostToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
}

const TEXT_OUTPUT_SCHEMA = { type: 'object', additionalProperties: true, properties: {} }

function textContent(text: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }]
}

function asRecord(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object' ? args as Record<string, unknown> : {}
}

const CITATION_FORMATS: CitationFormat[] = ['author-year', 'numeric', 'reference', 'bibtex']

/** 生成 5 个工具，交给 apply() 注册。 */
export function createTools(runtime: Runtime, evalDeps?: EvalDeps): HostToolDefinition[] {
  const definitions = buildTools(runtime, evalDeps)
  // 每个工具执行前都等运行时初始化完成（apply() 里的 init 是异步的，
  // 而工具注册必须同步完成，所以把等待放在执行入口）。
  return definitions.map((definition) => ({
    ...definition,
    async execute(args, exec) {
      await runtime.init()
      return definition.execute(args, exec)
    },
  }))
}

function buildTools(runtime: Runtime, evalDeps: EvalDeps | undefined): HostToolDefinition[] {
  const defaultTopK = runtime.defaultTopK

  return [
    {
      name: 'zotero_search',
      description:
        '在本地 Zotero 文献库已入库的正文里做检索（MinerU 解析出的 Markdown 分块，带章节路径与页码）。'
        + '回答文献内容问题前必须先调用本工具；引用时只能使用返回的 chunk_id。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: '检索问题，中英文均可，可用技术术语与编号' },
          top_k: { type: 'integer', minimum: 1, maximum: 20, description: `返回片段数，默认 ${defaultTopK}` },
          item_key: { type: 'string', description: '只在这一篇文献内检索时填写其 Zotero item_key' },
          mode: {
            type: 'string',
            enum: ['hybrid', 'lexical'],
            description: 'hybrid（默认）会叠加领域双语词表扩展，中文问英文文献也能命中；lexical 只做原始词面检索，用于对照',
          },
        },
        required: ['query'],
      },
      output: {
        schema: TEXT_OUTPUT_SCHEMA,
        render: (_args, value) => {
          const record = value as { text?: string }
          return textContent(record.text ?? '')
        },
      },
      async execute(rawArgs) {
        const args = asRecord(rawArgs)
        const query = String(args['query'] ?? '').trim()
        const topK = typeof args['top_k'] === 'number' ? args['top_k'] : defaultTopK
        const itemKey = typeof args['item_key'] === 'string' ? args['item_key'] : undefined
        const mode = args['mode'] === 'lexical' ? 'lexical' as const : 'hybrid' as const
        if (query.length === 0) return { text: '参数错误：query 不能为空。', hits: [] }
        const result = await runtime.search(query, { topK, source: 'tool', mode, ...(itemKey === undefined ? {} : { itemKey }) })
        const lines: string[] = []
        if (result.hits.length === 0) {
          lines.push(result.note ?? '文献库中没有相关内容。')
          if (result.metadataOnly.length > 0) {
            lines.push('', '匹配到但尚未入库的条目（可调用 zotero_index 入库）：')
            for (const item of result.metadataOnly) {
              lines.push(`- item_key=${item.key} · ${item.title}${item.year === null ? '' : ` (${item.year})`}`)
            }
          }
        } else {
          const modeLabel = result.mode === 'hybrid' ? 'BM25 词面 + 领域双语词表扩展，RRF 融合' : 'BM25 词面'
          lines.push(`检索命中 ${result.hits.length} 个片段（${modeLabel}）。引用格式：[来源: chunk_id]`)
          if (result.expansion !== null) lines.push(result.expansion.description)
          result.hits.forEach((hit, index) => {
            const page = hit.page === null ? '' : ` · 第 ${hit.page + 1} 页`
            const section = hit.sectionPath.length > 0 ? ` · ${hit.sectionPath}` : ''
            const route = hit.route === 'both' ? '词面+扩展' : hit.route === 'expanded' ? '跨语言扩展' : '词面'
            lines.push('', `[${index + 1}] chunk_id=${hit.chunkId} · 《${hit.title}》${section}${page} · 类型=${hit.kind} · 命中=${route} · score=${hit.score}`)
            lines.push(hit.text)
          })
          lines.push('', '注意：chunk_id 必须原样引用，不要改写或编造。')
        }
        return { text: lines.join('\n'), hits: result.hits, expansion: result.expansion }
      },
    },

    {
      name: 'zotero_read',
      description:
        '取回检索片段的完整正文（chunk_id），或读一篇文献的章节结构与各章节页码（item_key）。'
        + '检索结果被截断、或需要确认某篇文献的整体结构时使用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunk_id: { type: 'string', description: 'zotero_search 返回的 chunk_id' },
          item_key: { type: 'string', description: '看整篇结构时填 Zotero item_key' },
        },
        required: [],
      },
      output: {
        schema: TEXT_OUTPUT_SCHEMA,
        render: (_args, value) => textContent((value as { text?: string }).text ?? ''),
      },
      async execute(rawArgs) {
        const args = asRecord(rawArgs)
        const chunkId = typeof args['chunk_id'] === 'string' ? args['chunk_id'].trim() : ''
        const itemKey = typeof args['item_key'] === 'string' ? args['item_key'].trim() : ''
        if (chunkId.length > 0) {
          const found = await runtime.chunk(chunkId)
          if (found === null) return { text: `找不到 chunk ${chunkId}。可能还没入库，或 id 写错了。` }
          const page = found.chunk.page === null ? '未知' : String(found.chunk.page + 1)
          return {
            text: `chunk_id=${found.chunk.chunkId}\n标题：${found.chunk.title}\n章节：${found.chunk.sectionPath || '（无）'}\n页码：${page}\n类型：${found.chunk.kind}\n\n${found.chunk.text}`,
          }
        }
        if (itemKey.length > 0) {
          const detail = await runtime.markdown(itemKey)
          if (detail === null) return { text: `找不到条目 ${itemKey}。` }
          if (detail.parsed === null) {
            return { text: `《${detail.item.title}》还没有入库。先调用 zotero_index（item_key=${itemKey}）用 MinerU 解析。` }
          }
          const lines = [`《${detail.item.title}》章节结构（共 ${detail.chunks.length} 个分块）：`]
          const seen = new Set<string>()
          for (const chunk of detail.chunks) {
            const key = `${chunk.sectionPath}|${chunk.chunkId}`
            if (seen.has(key)) continue
            seen.add(key)
            const page = chunk.page === null ? '' : ` · 第 ${chunk.page + 1} 页`
            lines.push(`- ${chunk.chunkId} · ${chunk.sectionPath || '（无章节）'}${page} · ${chunk.tokens} tokens`)
          }
          return { text: lines.join('\n') }
        }
        return { text: '参数错误：chunk_id 与 item_key 至少给一个。' }
      },
    },

    {
      name: 'zotero_index',
      description:
        '用 MinerU 把一篇 Zotero 文献的 PDF 解析成 Markdown 并入库（只读 Zotero，不修改文献库）。'
        + '一篇 10 页论文通常需要 20-60 秒；同一份 PDF 已解析过会直接复用缓存。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item_key: { type: 'string', description: 'Zotero item_key（可从 zotero_library 或 zotero_search 的结果里拿）' },
        },
        required: ['item_key'],
      },
      output: {
        schema: TEXT_OUTPUT_SCHEMA,
        render: (_args, value) => textContent((value as { text?: string }).text ?? ''),
      },
      async execute(rawArgs, exec) {
        const args = asRecord(rawArgs)
        const itemKey = String(args['item_key'] ?? '').trim()
        if (itemKey.length === 0) return { text: '参数错误：item_key 不能为空。' }
        if (exec.signal.aborted) return { text: '已被取消。' }
        try {
          const result = await runtime.indexItem(itemKey)
          return {
            text: `已入库：《${result.title}》\nitem_key=${result.itemKey} · ${result.chunks} 个分块 · 结构来源=${result.source}${result.cached ? ' · 命中已解析缓存' : ''}\n解析产物：${result.dir}\n可以继续用 zotero_search（item_key=${result.itemKey}）提问。`,
            result,
          }
        } catch (error) {
          const described = Runtime.describeError(error)
          return { text: described.message, error: described }
        }
      },
    },

    {
      name: 'zotero_library',
      description:
        '浏览/检索 Zotero 文献条目元数据（标题、作者、年份、标签），返回 item_key。'
        + '用于找「用户提到的那篇文献」或在入库前确认条目。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: '标题/作者/标签关键词；留空则列出最近的条目' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数，默认 15' },
        },
        required: [],
      },
      output: {
        schema: TEXT_OUTPUT_SCHEMA,
        render: (_args, value) => textContent((value as { text?: string }).text ?? ''),
      },
      async execute(rawArgs) {
        const args = asRecord(rawArgs)
        const query = typeof args['query'] === 'string' ? args['query'] : ''
        const limit = typeof args['limit'] === 'number' ? Math.min(50, Math.max(1, args['limit'])) : 15
        const items = await runtime.listItems({ query, limit })
        if (items.length === 0) return { text: '没有匹配的条目。', items: [] }
        const lines = [`共 ${items.length} 条：`]
        items.forEach((item, index) => {
          const year = item.year === null ? '' : ` (${item.year})`
          const state = item.parsed ? '已入库' : '未入库'
          lines.push(`${index + 1}. item_key=${item.key} · ${item.title}${year} · ${state}`)
        })
        lines.push('', '未入库条目可用 zotero_index 解析入库。')
        return { text: lines.join('\n'), items }
      },
    },

    {
      name: 'zotero_eval',
      description:
        '跑一遍评测集，输出检索指标（recall@k / MRR）与生成侧引用指标（citation_accuracy / answer_rate）。'
        + '评测集是 JSONL，每题带 gold_chunk_id；报告落到数据目录的 reports/。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          qa_path: { type: 'string', description: '评测集 JSONL 路径；默认 <dataDir>/qa-set.jsonl' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: '只跑前 N 题（调试用）' },
          top_k: { type: 'integer', minimum: 1, maximum: 20, description: '检索 top-k，默认 5' },
          mode: {
            type: 'string',
            enum: ['hybrid', 'lexical'],
            description: '检索模式：hybrid（默认，含双语词表扩展）或 lexical（纯词面基线，用于对照）',
          },
        },
        required: [],
      },
      output: {
        schema: TEXT_OUTPUT_SCHEMA,
        render: (_args, value) => textContent((value as { text?: string }).text ?? ''),
      },
      async execute(rawArgs) {
        const args = asRecord(rawArgs)
        if (evalDeps === undefined) {
          return { text: '当前 profile 没有可用的模型服务，无法跑生成侧评测。' }
        }
        try {
          const result = await runEvalOnDisk(runtime, evalDeps, {
            ...(typeof args['qa_path'] === 'string' ? { qaPath: args['qa_path'] } : {}),
            ...(typeof args['limit'] === 'number' ? { limit: args['limit'] } : {}),
            ...(typeof args['top_k'] === 'number' ? { topK: args['top_k'] } : {}),
            ...(args['mode'] === 'lexical' ? { mode: 'lexical' as const } : {}),
          })
          const metrics = result.report.metrics
          return {
            text: [
              `评测完成：${result.report.qaSet.questions} 题 · 模型 ${result.report.model}`,
              `recall@${result.report.topK}=${metrics.recallAtK} · MRR=${metrics.mrr} · hit_rate=${metrics.hitRate}`,
              `citation_accuracy=${metrics.citationAccuracy ?? '—'} · answer_rate=${metrics.answerRate} · 平均引用 ${metrics.avgCitations} 条`,
              `报告：${result.mdPath}`,
            ].join('\n'),
            result,
          }
        } catch (error) {
          return { text: Runtime.describeError(error).message }
        }
      },
    },
    {
      name: 'zotero_cite',
      description:
        '为一组 Zotero 条目生成引用文本：author-year 行内引用、numeric 编号、reference 参考文献行、bibtex。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item_keys: { type: 'array', items: { type: 'string' }, description: 'Zotero item_key 列表' },
          format: { type: 'string', enum: CITATION_FORMATS, description: '默认 author-year' },
        },
        required: ['item_keys'],
      },
      output: {
        schema: TEXT_OUTPUT_SCHEMA,
        render: (_args, value) => textContent((value as { text?: string }).text ?? ''),
      },
      async execute(rawArgs) {
        const args = asRecord(rawArgs)
        const keys = Array.isArray(args['item_keys'])
          ? (args['item_keys'] as unknown[]).filter((key): key is string => typeof key === 'string')
          : []
        const formatRaw = String(args['format'] ?? 'author-year')
        const format = (CITATION_FORMATS as string[]).includes(formatRaw) ? formatRaw as CitationFormat : 'author-year'
        if (keys.length === 0) return { text: '参数错误：item_keys 不能为空。' }
        const citations = await runtime.cite(keys, format)
        const lines = citations.map((citation) => citation.text)
        return {
          text: citations.length === 0
            ? `${keys.join(', ')} 都找不到（可能 item_key 不对）。`
            : `格式：${format}\n\n${lines.join('\n')}`,
          citations,
        }
      },
    },
  ]
}


