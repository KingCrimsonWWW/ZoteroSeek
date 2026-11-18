/**
 * BM25 检索：进程内、零依赖、可解释。
 *
 * 选它的理由（也是这个项目在简历上要讲清楚的点）：
 * - 个人文献库规模是「几百篇论文 / 几千个 chunk」，BM25 是毫秒级，
 *   不需要向量库、不需要 embedding 权重下载、不需要 sidecar 进程；
 * - 词面检索在「技术术语 + 编号 + 公式名」上有天然优势，可解释（能报出
 *   命中了 query 的哪几个词），引用核对时用户可以自己复核；
 * - 中文没有空格，所以对 CJK 用二元 bigram 建倒排，等价于一个轻量分词器。
 *
 * 字段加权体现在词频上：标题 *3、章节路径 *2、正文 *1。
 */

/** 中文/日文汉字与全角字符区段。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 高频虚词：单字 token 时直接丢弃，避免「的数了在」这类噪声词主导打分。 */
const CJK_STOP = new Set([
  '的', '了', '和', '与', '及', '在', '是', '为', '对', '中', '下', '上', '有', '无',
  '不', '也', '就', '这', '那', '其', '之', '或', '等', '个', '被', '把', '从', '到',
  '并', '而', '以', '可', '将', '所', '如', '由', '于', '该', '此', '各', '即', '则',
])

const LATIN_STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'by', 'is',
  'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its',
  'as', 'at', 'from', 'we', 'our', 'can', 'not', 'but', 'has', 'have', 'had', 'which',
])

/**
 * 把文本切成检索 token。
 *
 * - 拉丁字母/数字：连续串整体成词（小写），长度 ≥2 才保留，纯数字保留；
 * - CJK：连续汉字串切成二元 bigram（只有 1 个字时保留单字，除非是虚词）；
 * - 其他符号（标点、公式符号）不产生 token，但公式里的数字字母仍会被切出来。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let latin = ''
  let cjkRun = ''

  const flushLatin = (): void => {
    if (latin.length === 0) return
    const word = latin.toLowerCase()
    if (word.length >= 2 && !LATIN_STOP.has(word)) tokens.push(word)
    else if (/^\d+$/.test(word) && word.length >= 2) tokens.push(word)
    latin = ''
  }
  const flushCjk = (): void => {
    if (cjkRun.length === 0) return
    if (cjkRun.length === 1) {
      if (!CJK_STOP.has(cjkRun)) tokens.push(cjkRun)
    } else {
      for (let i = 0; i + 1 < cjkRun.length; i += 1) tokens.push(cjkRun.slice(i, i + 2))
    }
    cjkRun = ''
  }

  for (const char of text) {
    if (CJK.test(char)) {
      flushLatin()
      cjkRun += char
    } else if (/[A-Za-z0-9]/.test(char)) {
      flushCjk()
      latin += char
    } else {
      flushLatin()
      flushCjk()
    }
  }
  flushLatin()
  flushCjk()
  return tokens
}

export interface Bm25Doc {
  id: string
  title: string
  section: string
  text: string
}

export interface Bm25Hit {
  id: string
  score: number
  /** 命中的 query 词，按贡献从大到小取前若干个，用于解释与调参。 */
  matched: string[]
}

export interface Bm25Options {
  k1?: number
  b?: number
  titleWeight?: number
  sectionWeight?: number
  textWeight?: number
}

export class Bm25Index {
  private readonly k1: number
  private readonly b: number
  private readonly weights: { title: number; section: number; text: number }
  private postings = new Map<string, Map<number, number>>()
  private lengths: number[] = []
  private docIds: string[] = []
  private avgLength = 0

  constructor(options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2
    this.b = options.b ?? 0.75
    this.weights = {
      title: options.titleWeight ?? 3,
      section: options.sectionWeight ?? 2,
      text: options.textWeight ?? 1,
    }
  }

  get size(): number {
    return this.docIds.length
  }

  build(docs: readonly Bm25Doc[]): void {
    this.postings = new Map()
    this.lengths = new Array(docs.length).fill(0)
    this.docIds = docs.map((doc) => doc.id)

    docs.forEach((doc, index) => {
      const counts = new Map<string, number>()
      const add = (tokens: string[], weight: number): void => {
        for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + weight)
      }
      add(tokenize(doc.title), this.weights.title)
      add(tokenize(doc.section), this.weights.section)
      add(tokenize(doc.text), this.weights.text)

      let length = 0
      for (const [token, tf] of counts) {
        length += tf
        let posting = this.postings.get(token)
        if (posting === undefined) {
          posting = new Map()
          this.postings.set(token, posting)
        }
        posting.set(index, tf)
      }
      this.lengths[index] = length
    })
    const total = this.lengths.reduce((sum, value) => sum + value, 0)
    this.avgLength = this.docIds.length === 0 ? 0 : total / this.docIds.length
  }

  /**
   * 检索 topK。query 的 token 去重后按 idf 累加；idf 用常见的
   * ln(1 + (N-df+0.5)/(df+0.5)) 形式，恒为正，避免停用词被负分惩罚。
   */
  search(query: string, topK = 8): Bm25Hit[] {
    const terms = [...new Set(tokenize(query))]
    if (terms.length === 0 || this.docIds.length === 0) return []

    const scores = new Map<number, number>()
    const matches = new Map<number, string[]>()
    const docCount = this.docIds.length

    for (const term of terms) {
      const posting = this.postings.get(term)
      if (posting === undefined) continue
      const df = posting.size
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5))
      for (const [docIndex, tf] of posting) {
        const length = this.lengths[docIndex] ?? 0
        const norm = 1 - this.b + (this.b * length) / (this.avgLength || 1)
        const score = idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm))
        scores.set(docIndex, (scores.get(docIndex) ?? 0) + score)
        const list = matches.get(docIndex)
        if (list === undefined) matches.set(docIndex, [term])
        else list.push(term)
      }
    }

    return [...scores.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, Math.max(1, topK))
      .map(([docIndex, score]) => ({
        id: this.docIds[docIndex] ?? '',
        score,
        matched: (matches.get(docIndex) ?? []).slice(0, 8),
      }))
  }
}
