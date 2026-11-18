/**
 * 评测：检索指标 + 生成侧引用指标，一份代码两种口径。
 *
 * - 检索指标（recall@k / MRR / hit_rate）只依赖索引，模型无关、可离线复现；
 * - 生成指标（citation_accuracy / answer_rate）走 `answerGrounded`，模型调用由
 *   `complete` 注入（插件里是 DSH 的 llm 服务）。
 *
 * 评测集的每道题都标注 `gold_chunk_id`（人工确认的「答案所在片段」）。这让
 * 「答对没答对」可以被拆成两个可分别优化的问题：检索有没有找对片段、生成有没有用对片段。
 */
import type { Library } from './library.ts'
import { answerGrounded, verifyCitations } from './grounding.ts'

export interface QaRow {
  id: string
  q: string
  item_key?: string
  gold_chunk_id: string
  type?: string
}

export interface GenerationDeps {
  complete: (parts: { system: string; user: string }) => Promise<string>
}

export interface QaResult {
  id: string
  type: string
  q: string
  gold: string
  rank: number | null
  top: string[]
  answer: string
  /** 答案里出现的合法引用编号。 */
  citations: number[]
  /** 答案里出现的全部引用编号（含非法）。 */
  rawCitations: number[]
  invalid: number[]
  retried: boolean
  citationsStripped: boolean
}

export interface EvalReport {
  generatedAt: string
  model: string
  topK: number
  qaSet: { path: string; questions: number }
  index: { chunks: number; parsedItems: number }
  metrics: {
    recallAtK: number
    mrr: number
    hitRate: number
    /** 合法引用 / 全部引用；没有任何引用时为 null。 */
    citationAccuracy: number | null
    /** 至少一条合法引用的回答比例。 */
    answerRate: number
    /** 平均回答里引用了几条片段。 */
    avgCitations: number
  }
  byType: Record<string, { total: number; recall: number }>
  results: QaResult[]
  failures: QaResult[]
}

export interface RunEvalOptions {
  library: Library
  rows: readonly QaRow[]
  topK?: number
  deps: GenerationDeps
  modelLabel: string
  qaPath: string
  /** 只跑前 N 题（调试用）。 */
  limit?: number
  signal?: AbortSignal
}

export async function runEval(options: RunEvalOptions): Promise<EvalReport> {
  const topK = options.topK ?? 5
  const rows = options.limit === undefined ? options.rows : options.rows.slice(0, options.limit)
  const results: QaResult[] = []

  for (const row of rows) {
    if (options.signal?.aborted === true) break
    const hits = options.library.search(row.q, {
      topK,
      ...(row.item_key === undefined ? {} : { itemKey: row.item_key }),
    })
    const rankIndex = hits.findIndex((hit) => hit.chunkId === row.gold_chunk_id)

    // 生成侧：复用产品同一套 grounded 逻辑（先检索 → 只允许引用本轮编号 → 校验）。
    const grounded = await answerGrounded(row.q, {
      search: (query, k) => options.library.search(query, {
        topK: k,
        ...(row.item_key === undefined ? {} : { itemKey: row.item_key }),
      }),
      complete: options.deps.complete,
      topK,
    })
    const check = verifyCitations(grounded.answer, hits.length)
    const rawCitations = rawCitationNumbers(grounded.answer, hits.length)

    results.push({
      id: row.id,
      type: row.type ?? 'fact',
      q: row.q,
      gold: row.gold_chunk_id,
      rank: rankIndex < 0 ? null : rankIndex + 1,
      top: hits.map((hit) => hit.chunkId),
      answer: grounded.answer,
      citations: grounded.citations,
      rawCitations,
      invalid: rawCitations.filter((value) => value < 1 || value > hits.length),
      retried: grounded.retried,
      citationsStripped: grounded.citationsStripped,
    })
    void check
  }

  const total = results.length
  const found = results.filter((result) => result.rank !== null)
  const rawTotal = results.reduce((sum, result) => sum + result.rawCitations.length, 0)
  const invalidTotal = results.reduce((sum, result) => sum + result.invalid.length, 0)
  const byType = new Map<string, { total: number; found: number }>()
  for (const result of results) {
    const bucket = byType.get(result.type) ?? { total: 0, found: 0 }
    bucket.total += 1
    if (result.rank !== null) bucket.found += 1
    byType.set(result.type, bucket)
  }

  return {
    generatedAt: new Date().toISOString(),
    model: options.modelLabel,
    topK,
    qaSet: { path: options.qaPath, questions: total },
    index: {
      chunks: options.library.stats().chunks,
      parsedItems: options.library.stats().parsedItems,
    },
    metrics: {
      recallAtK: round(total === 0 ? 0 : found.length / total),
      mrr: round(total === 0 ? 0 : found.reduce((sum, result) => sum + 1 / (result.rank ?? Number.POSITIVE_INFINITY), 0) / total),
      hitRate: round(total === 0 ? 0 : results.filter((result) => result.top.length > 0).length / total),
      citationAccuracy: rawTotal === 0 ? null : round(1 - invalidTotal / rawTotal),
      answerRate: round(total === 0 ? 0 : results.filter((result) => result.citations.length > 0).length / total),
      avgCitations: round(total === 0 ? 0 : results.reduce((sum, result) => sum + result.citations.length, 0) / total),
    },
    byType: Object.fromEntries([...byType].map(([type, bucket]) => [type, {
      total: bucket.total,
      recall: round(bucket.total === 0 ? 0 : bucket.found / bucket.total),
    }])),
    results,
    failures: results.filter((result) => result.rank === null || result.rank > 3),
  }
}

/** 答案里出现的全部引用编号（含越界的），用于算 citation_accuracy 的分子分母。 */
function rawCitationNumbers(answer: string, allowed: number): number[] {
  const found: number[] = []
  for (const match of answer.matchAll(/\[\^(\d+)\^?\]/g)) {
    const value = Number(match[1])
    if (Number.isInteger(value) && value > 0 && !found.includes(value)) found.push(value)
  }
  return found
}

export function renderEvalReport(report: EvalReport): string {
  const lines: string[] = []
  lines.push('# 评测报告（检索 + 引用）')
  lines.push('')
  lines.push(`- 生成时间：${report.generatedAt}`)
  lines.push(`- 模型：\`${report.model}\``)
  lines.push(`- 评测集：${report.qaSet.questions} 题（${report.qaSet.path}）`)
  lines.push(`- 索引：${report.index.chunks} 分块 / ${report.index.parsedItems} 篇已入库`)
  lines.push(`- 口径：检索 \`top_k = ${report.topK}\`；生成侧引用标记只认 \`[^N^]\``)
  lines.push('')
  lines.push('| 指标 | 数值 |')
  lines.push('|---|---|')
  lines.push(`| recall@${report.topK} | ${report.metrics.recallAtK} |`)
  lines.push(`| MRR | ${report.metrics.mrr} |`)
  lines.push(`| hit_rate | ${report.metrics.hitRate} |`)
  lines.push(`| citation_accuracy | ${report.metrics.citationAccuracy === null ? '—' : report.metrics.citationAccuracy} |`)
  lines.push(`| answer_rate | ${report.metrics.answerRate} |`)
  lines.push(`| 平均引用条数 | ${report.metrics.avgCitations} |`)
  lines.push('')
  lines.push('| 题型 | 题数 | recall |')
  lines.push('|---|---|---|')
  for (const [type, bucket] of Object.entries(report.byType)) {
    lines.push(`| ${type} | ${bucket.total} | ${bucket.recall} |`)
  }
  if (report.failures.length > 0) {
    lines.push('')
    lines.push('## 未进入前 3 的题')
    lines.push('')
    for (const failure of report.failures) {
      lines.push(`- \`${failure.id}\` ${failure.q} — gold=${failure.gold} rank=${failure.rank ?? '未命中'}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}
