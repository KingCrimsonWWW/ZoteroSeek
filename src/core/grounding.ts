/**
 * Grounded 作答与引用校验。
 *
 * 这是「不答错」的核心机制，和普通 RAG 的区别在于**引用是事后可验证的**：
 * 1. 模型只拿得到检索片段（带编号），提示词规定「每句陈述标注 [^N^]」；
 * 2. 生成后用程序解析所有 [^N^]，N 必须落在本轮检索编号集合里；
 * 3. 不合法引用：先回填一条纠正消息重试一次；仍不合法就剥离标记并标注
 *    citations_stripped，绝不把「看着像引用」的假引用交给用户；
 * 4. 评测指标 citation_accuracy = 合法引用数 / 全部引用数，由脚本判定，
 *    不靠模型自评。
 *
 * 本模块不依赖 DSH：模型调用通过 `complete(prompt) => Promise<string>` 注入，
 * 所以评测脚本和插件里可以共用同一套逻辑。
 */
import type { SearchHit } from './types.ts'

export interface CitationCheck {
  ok: boolean
  /** 答案里出现的全部引用编号，按出现顺序去重。 */
  citations: number[]
  /** 不在本轮检索集合里的编号。 */
  invalid: number[]
}

export const GROUNDED_SYSTEM_PROMPT = `你是 ZoteroSeek，一个只根据本地文献库检索结果作答的研究助手。

## 硬性规则
1. 只能使用【检索片段】里出现的信息作答，不使用你自己的知识补充任何事实。
2. 每一条有依据的陈述，在句末标注引用，格式为 [^N^]，N 是片段编号（从 1 开始），可以连写多个如 [^1^][^3^]。
3. 检索片段不足以回答时，直接说「文献库中没有相关内容」，并说明缺少什么；不要猜测、不要拼凑。
4. 不编造标题、作者、年份、页码、期刊名、实验数值。片段里没有的数字不要写。
5. 表格与公式请按原文逻辑解释，不要重写成看起来更整齐但其实不同的形式。
6. 用简体中文回答；术语可保留英文原文。

## 输出格式
- 先给 1-3 句结论，再给分点依据；每个分点的依据句末必须有 [^N^]。
- 结尾不要重复整段引用列表。`

export interface PromptParts {
  system: string
  user: string
}

/** 把检索片段编号拼进用户消息。片段正文原样保留，不做摘要，避免二次失真。 */
export function buildPrompt(question: string, hits: readonly SearchHit[]): PromptParts {
  const blocks = hits.map((hit, index) => {
    const location = [hit.title, hit.sectionPath, hit.page === null ? null : `第 ${hit.page + 1} 页`]
      .filter((part): part is string => part !== null && part.length > 0)
      .join(' · ')
    return `【片段 ${index + 1}】chunk_id=${hit.chunkId} · ${location} · 类型=${hit.kind}\n${hit.text}`
  })
  const user = `## 问题\n${question}\n\n## 检索片段（只允许引用以下编号）\n${blocks.join('\n\n')}`
  return { system: GROUNDED_SYSTEM_PROMPT, user }
}

/** 引用标记解析：接受 [^N^] 与 [^N] 两种写法；普通方括号（如 [1]）不算引用，避免误杀。 */
export function parseCitations(answer: string): number[] {
  const found: number[] = []
  const pattern = /\[\^(\d+)\^?\]/g
  for (const match of answer.matchAll(pattern)) {
    const value = Number(match[1])
    if (Number.isInteger(value) && value > 0 && !found.includes(value)) found.push(value)
  }
  return found
}

export function verifyCitations(answer: string, allowedCount: number): CitationCheck {
  const citations = parseCitations(answer)
  const invalid = citations.filter((value) => value < 1 || value > allowedCount)
  return { ok: invalid.length === 0, citations, invalid }
}

/** 剥离非法引用标记，保留正常文本；用于重试后仍不合法的降级路径。 */
export function stripInvalidCitations(answer: string, allowedCount: number): string {
  return answer.replace(/\[\^(\d+)\^?\]/g, (whole, digits: string) => {
    const value = Number(digits)
    return value >= 1 && value <= allowedCount ? whole : ''
  })
}

export interface GroundedAnswer {
  answer: string
  /** 剥离非法引用之后、真正合法的引用编号。 */
  citations: number[]
  /** 模型原始回答里出现过的全部引用编号（含非法），评测用。 */
  rawCitations: number[]
  /** 被判定为非法的编号。 */
  invalidCitations: number[]
  /** 是否触发了「引用不合法 → 回填纠正」的重试。 */
  retried: boolean
  /** 最终答案是否被剥离过非法引用。 */
  citationsStripped: boolean
  steps: number
}

export interface GroundedOptions {
  /** 调用模型；由宿主注入（插件里是 DSH 的 llm 服务，评测里是直接 HTTP）。 */
  complete: (parts: PromptParts) => Promise<string>
  /** 检索函数，tool 语义与 BM25 一致。 */
  search: (query: string, topK: number) => SearchHit[]
  topK?: number
  /** 纠错重试次数上限（默认 1）。 */
  maxRetries?: number
}

/**
 * 最小可用的 grounded 生成循环：
 * 检索一次 → 生成 → 校验引用 → 不合法则带纠正提示重试一次 → 仍不合法就剥离。
 *
 * 刻意不做多步工具调用：产品路径里 Agent 自己会多轮检索（DSH 的 Agent 循环），
 * 这个函数服务的是「评测」和面板里的「一键总结」，要的是确定性和可复现。
 */
export async function answerGrounded(question: string, options: GroundedOptions): Promise<GroundedAnswer> {
  const topK = options.topK ?? 8
  const maxRetries = options.maxRetries ?? 1
  const hits = options.search(question, topK)
  const steps = 1
  if (hits.length === 0) {
    return {
      answer: '文献库中没有相关内容。可以先把相关文献入库（zotero_index 工具）再提问。',
      citations: [],
      rawCitations: [],
      invalidCitations: [],
      retried: false,
      citationsStripped: false,
      steps,
    }
  }

  const parts = buildPrompt(question, hits)
  let answer = await options.complete(parts)
  let check = verifyCitations(answer, hits.length)
  let retried = false

  if (!check.ok && maxRetries > 0) {
    retried = true
    answer = await options.complete({
      system: parts.system,
      user: `${parts.user}\n\n## 纠正\n你上一次的回答引用了片段编号之外的编号：${check.invalid.map((n) => `[^${n}^]`).join('')}。只允许引用 1..${hits.length}。请重新回答。`,
    })
    check = verifyCitations(answer, hits.length)
  }

  const rawCitations = [...check.citations, ...check.invalid].sort((left, right) => left - right)
  const invalidCitations = [...check.invalid]

  let citationsStripped = false
  if (!check.ok) {
    answer = stripInvalidCitations(answer, hits.length)
    check = verifyCitations(answer, hits.length)
    citationsStripped = true
  }

  return {
    answer,
    citations: check.citations,
    rawCitations,
    invalidCitations,
    retried,
    citationsStripped,
    steps,
  }
}
