/**
 * 分块器：把 MinerU 的版面块切成可检索的 chunk。
 *
 * 两条输入路径，共用同一个切块算法：
 * - 主路径：MinerU 的 `content_list_v2.json`（按页分组，页码天然保留）或
 *   `content_list.json`（扁平，带 page_idx）；
 * - 兜底路径：直接解析 `full.md`（标题层级 + 段落 + 表格 + 公式 + 代码块 + 图片）。
 *   这条路径让我们在没有 MinerU token 时也能用 Zotero 全文，或者验证解析产物的完整性。
 *
 * 切块规则（也是评测里能解释的部分）：
 * - 目标 800 tokens、重叠 100 tokens；表格/公式/代码块是**原子块**，绝不切开；
 * - 章节路径（"3 Methods > 3.2 Void detection"）作为 chunk 元数据，检索时加权；
 * - 每块记首页码，回答里可以标页码，用户拿原文核对。
 */
import type { BlockKind, Chunk, ContentBlock } from './types.ts'

export interface ChunkOptions {
  maxTokens?: number
  overlapTokens?: number
  minTokens?: number
}

const DEFAULTS: Required<ChunkOptions> = {
  maxTokens: 800,
  overlapTokens: 100,
  minTokens: 40,
}

/** 粗略 token 估算：汉字 1 字≈1 token，英文按 4 字符≈1 token，符号按 0.25。 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let latin = 0
  let other = 0
  for (const char of text) {
    if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(char)) cjk += 1
    else if (/[A-Za-z0-9]/.test(char)) latin += 1
    else other += 1
  }
  return Math.ceil(cjk * 1.0 + latin / 4 + other * 0.25)
}

/** 把内容块切成 chunk。输入应为单篇文献的全部块，按阅读顺序排列。 */
export function buildChunks(
  item: { key: string; title: string },
  blocks: readonly ContentBlock[],
  options: ChunkOptions = {},
): Chunk[] {
  const { maxTokens, overlapTokens, minTokens } = { ...DEFAULTS, ...options }
  const chunks: Chunk[] = []
  const sectionStack: string[] = []
  let buffer: ContentBlock[] = []
  let bufferTokens = 0
  let bufferSection = ''
  let seq = 0

  const flush = (): void => {
    if (buffer.length === 0) return
    const text = buffer.map((block) => block.text).join('\n\n').trim()
    // 参考文献列表不是可引用正文：整块丢弃，避免检索命中一堆 [29] 引文。
    if (!isReferenceDominated(text) && text.length > 0 && estimateTokens(text) >= minTokens) {
      const first = buffer[0]
      chunks.push({
        chunkId: `${item.key}:${String(seq).padStart(4, '0')}`,
        itemKey: item.key,
        title: item.title,
        sectionPath: bufferSection,
        page: first?.page ?? null,
        kind: dominantKind(buffer),
        text,
        tokenEstimate: estimateTokens(text),
      })
      seq += 1
    }
    // 重叠：保留尾部若干块，下一次从这里续上，避免关键句被切在边界上。
    const tail: ContentBlock[] = []
    let tailTokens = 0
    for (let index = buffer.length - 1; index >= 0; index -= 1) {
      const block = buffer[index]
      if (block === undefined) continue
      const tokens = estimateTokens(block.text)
      if (tailTokens + tokens > overlapTokens) break
      tail.unshift(block)
      tailTokens += tokens
    }
    buffer = tail
    bufferTokens = tailTokens
    if (buffer.length === 0) bufferSection = ''
  }

  /** 入缓冲区：buffer 为空时先把「当前章节」定格，保证 chunk 的 sectionPath 是它起点的章节。 */
  const push = (block: ContentBlock): void => {
    if (buffer.length === 0) bufferSection = sectionStack.join(' > ')
    buffer.push(block)
    bufferTokens += estimateTokens(block.text)
  }

  // 论文首页的一级标题通常就是文献标题：它已经作为 title 字段参与加权，
  // 再塞进 chunk 正文与章节路径只会制造噪声，所以这里直接跳过。
  const titleKey = normalizeHeading(item.title)
  const isDocumentTitle = (block: ContentBlock): boolean =>
    block.headingLevel === 1 && normalizeHeading(block.text) === titleKey

  // 版面噪声标题：Elsevier 侧栏、页眉标签之类的「伪章节」，不该进章节路径。
  const LABEL_HEADING = /^(articleinfo|abstract|highlights?|keywords?|contentslists.*|题目.*|学位论文|专业学位|独创性声明)$/i
  // 后置内容（参考文献、致谢、附录……）不是可引用正文，进索引只会制造噪声。
  const BACK_MATTER_HEADING = /^(references?|bibliography|参考文献|致谢|acknowledg(e)?ments?|appendix|附录|作者简介|declarationofcompetinginterest|dataavailability|作者贡献)/i
  const isLabelHeading = (block: ContentBlock): boolean =>
    LABEL_HEADING.test(block.text.replace(/\s+/g, '').toLowerCase())

  // 开头的 H1 若是「长标题」（文献标题 / 学位论文封面行）就跳过；
  // 像「# 3 方法」这种短标题是真正的章节，必须保留。
  let seenBodyHeading = false
  const isLeadingTitle = (block: ContentBlock): boolean =>
    !seenBodyHeading
    && block.headingLevel === 1
    && normalizeHeading(block.text).length >= 20

  for (const block of blocks) {
    if (block.headingLevel !== null && block.text.trim().length > 0) {
      if (isDocumentTitle(block) || isLeadingTitle(block) || isLabelHeading(block)) continue
      const depth = headingDepth(block)
      if (depth > 1) seenBodyHeading = true
      // 标题先落进章节栈：同级替换、低级别出栈，保证路径始终是当前活跃章节。
      while (sectionStack.length >= depth) sectionStack.pop()
      sectionStack.push(block.text.trim())
      push(block)
      continue
    }
    if (block.text.trim().length === 0 && block.imagePath === null) continue

    const tokens = estimateTokens(block.text)
    const atomic = block.kind === 'table' || block.kind === 'equation' || block.kind === 'code'

    if (!atomic && bufferTokens + tokens > maxTokens && buffer.length > 0) {
      flush()
    }
    push(block)

    if (atomic && bufferTokens > maxTokens * 2) {
      // 单个超大原子块（长表格）：仍然保留整块，但独立成 chunk，避免拖累后续。
      flush()
    }
    if (!atomic && bufferTokens >= maxTokens) flush()
  }
  flush()
  return chunks
}

/** v1 扁平块 / v2 按页分组块 → 统一 ContentBlock。 */
export function blocksFromContentList(raw: unknown): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (Array.isArray(raw)) {
    const pageGrouped = raw.length > 0 && Array.isArray(raw[0])
    raw.forEach((entry, index) => {
      if (pageGrouped) {
        for (const block of entry as unknown[]) {
          const normalized = normalizeBlock(block, index)
          if (normalized !== null) blocks.push(normalized)
        }
      } else {
        const normalized = normalizeBlock(entry, null)
        if (normalized !== null) blocks.push(normalized)
      }
    })
  } else if (raw !== null && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    const nested = record['pages'] ?? record['content_list'] ?? record['blocks']
    if (Array.isArray(nested)) return blocksFromContentList(nested)
  }
  return blocks
}

function normalizeBlock(raw: unknown, fallbackPage: number | null): ContentBlock | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const type = String(record['type'] ?? '')
  const textOf = (...keys: string[]): string => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim().length > 0) return value
      if (Array.isArray(value)) {
        const joined = value.filter((item): item is string => typeof item === 'string').join('\n')
        if (joined.trim().length > 0) return joined
      }
    }
    return ''
  }
  const page = typeof record['page_idx'] === 'number'
    ? (record['page_idx'] as number)
    : typeof record['page'] === 'number' ? (record['page'] as number) : fallbackPage

  if (type === 'title' || type === 'text') {
    const levelRaw = record['text_level'] ?? record['level']
    const level = typeof levelRaw === 'number' && levelRaw >= 1 && levelRaw <= 6 ? levelRaw : null
    const text = textOf('text', 'content')
    if (text.trim().length === 0) return null
    return {
      kind: level === null ? (type === 'title' ? 'title' : 'text') : 'title',
      text,
      page,
      headingLevel: level ?? (type === 'title' ? 1 : null),
      imagePath: null,
    }
  }
  if (type === 'table') {
    const body = textOf('table_body', 'html', 'text')
    const caption = textOf('table_caption', 'caption')
    const footnote = textOf('table_footnote')
    const merged = [caption, body, footnote].filter((part) => part.length > 0).join('\n\n')
    return merged.length === 0 ? null : { kind: 'table', text: merged, page, headingLevel: null, imagePath: null }
  }
  if (type === 'image' || type === 'figure') {
    const caption = textOf('image_caption', 'caption', 'image_footnote')
    const imgPath = typeof record['img_path'] === 'string' ? record['img_path'] : null
    // 只有图注的图才值得进索引：没有图注的图放进检索只会贡献噪声。
    // 图片本身仍然会在 Markdown 阅读视图里渲染出来，不影响核对原文。
    if (caption.length === 0) return null
    return {
      kind: 'image',
      text: caption,
      page,
      headingLevel: null,
      imagePath: imgPath,
    }
  }
  if (type === 'equation' || type === 'interline_equation' || type === 'formula') {
    const text = textOf('text', 'latex', 'content')
    return text.length === 0 ? null : { kind: 'equation', text, page, headingLevel: null, imagePath: null }
  }
  if (type === 'list' || type === 'code') {
    const text = textOf('text', 'content', 'code_body')
    return text.length === 0 ? null : { kind: type, text, page, headingLevel: null, imagePath: null }
  }
  // 未知类型：有文本就当正文，至少别丢内容。
  const fallbackText = textOf('text', 'content')
  return fallbackText.length === 0
    ? null
    : { kind: 'other', text: fallbackText, page, headingLevel: null, imagePath: null }
}

/** full.md → 内容块（兜底路径，也是单测最容易造 fixture 的路径）。 */
export function blocksFromMarkdown(markdown: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  let inCode = false
  let codeLines: string[] = []
  let inMath = false
  let mathLines: string[] = []
  let tableLines: string[] = []

  const flushParagraph = (): void => {
    const text = paragraph.join('\n').trim()
    if (text.length > 0) blocks.push({ kind: 'text', text, page: null, headingLevel: null, imagePath: null })
    paragraph = []
  }
  const flushTable = (): void => {
    const text = tableLines.join('\n').trim()
    if (text.length > 0) blocks.push({ kind: 'table', text, page: null, headingLevel: null, imagePath: null })
    tableLines = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (inCode) {
      if (trimmed.startsWith('```')) {
        inCode = false
        const text = codeLines.join('\n').trim()
        if (text.length > 0) blocks.push({ kind: 'code', text, page: null, headingLevel: null, imagePath: null })
        codeLines = []
      } else {
        codeLines.push(line)
      }
      continue
    }
    if (inMath) {
      mathLines.push(line)
      if (trimmed.endsWith('$$')) {
        inMath = false
        const text = mathLines.join('\n').trim()
        if (text.length > 0) blocks.push({ kind: 'equation', text, page: null, headingLevel: null, imagePath: null })
        mathLines = []
      }
      continue
    }
    if (trimmed.startsWith('```')) {
      flushParagraph()
      flushTable()
      inCode = true
      continue
    }
    if (trimmed.startsWith('$$')) {
      flushParagraph()
      flushTable()
      if (trimmed.length > 2 && trimmed.endsWith('$$')) {
        blocks.push({ kind: 'equation', text: trimmed, page: null, headingLevel: null, imagePath: null })
      } else {
        inMath = true
        mathLines = [line]
      }
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (heading !== null) {
      flushParagraph()
      flushTable()
      blocks.push({
        kind: 'title',
        text: heading[2] ?? '',
        page: null,
        headingLevel: heading[1]?.length ?? 1,
        imagePath: null,
      })
      continue
    }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(trimmed)
    if (image !== null) {
      flushParagraph()
      flushTable()
      blocks.push({
        kind: 'image',
        text: (image[1] ?? '').trim().length === 0 ? '（插图）' : (image[1] ?? '').trim(),
        page: null,
        headingLevel: null,
        imagePath: image[2] ?? null,
      })
      continue
    }
    if (trimmed.startsWith('|') || trimmed.startsWith('<table')) {
      flushParagraph()
      tableLines.push(line)
      if (trimmed.startsWith('</table')) {
        flushTable()
      }
      continue
    }
    if (trimmed.length === 0) {
      flushParagraph()
      if (tableLines.length > 0) flushTable()
      continue
    }
    if (tableLines.length > 0) {
      // 表格结束（后面接了普通段落）
      flushTable()
    }
    paragraph.push(line)
  }
  flushParagraph()
  flushTable()
  if (inCode && codeLines.length > 0) {
    blocks.push({ kind: 'code', text: codeLines.join('\n'), page: null, headingLevel: null, imagePath: null })
  }
  if (inMath && mathLines.length > 0) {
    blocks.push({ kind: 'equation', text: mathLines.join('\n'), page: null, headingLevel: null, imagePath: null })
  }
  return blocks
}

/**
 * 标题层级：MinerU 的 vlm 后端经常把所有标题都标成同一级，
 * 所以优先看标题文本自己的编号（"2." 一层、"2.1." 两层、"2.1.3." 三层），
 * 没有编号才退回 text_level。
 */
function headingDepth(block: ContentBlock): number {
  const text = block.text.trim()
  const numbered = /^(\d+(?:\.\d+)*)[.、]?\s+\S/.exec(text)
  if (numbered !== null && numbered[1] !== undefined) {
    const depth = numbered[1].split('.').length
    return Math.min(3, Math.max(1, depth))
  }
  if (/^第[一二三四五六七八九十百零\d]+[章节]/.test(text)) return 1
  const level = block.headingLevel ?? 1
  return Math.min(3, Math.max(1, level))
}

/**
 * 判断一段文本是不是参考文献列表：参考文献行通常以「[12]」或「[12-15]」开头，
 * 夹杂作者、年份与 DOI。过半行满足就认为整块是参考文献，不进索引。
 */
function isReferenceDominated(text: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.length < 4) return false
  const referenceLines = lines.filter((line) => /^\[\d+\]|^\[\d+[–-]\d+\]/.test(line)).length
  return referenceLines / lines.length > 0.5
}

/** 标题归一化：去掉空白、大小写、末尾标点，用于判断「这行标题是不是文献标题本身」。 */
function normalizeHeading(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[.:;、，。]+$/, '').trim()
}

function dominantKind(blocks: readonly ContentBlock[]): Chunk['kind'] {
  let tables = 0
  let equations = 0
  let images = 0
  let texts = 0
  for (const block of blocks) {
    if (block.kind === 'table') tables += block.text.length
    else if (block.kind === 'equation') equations += block.text.length
    else if (block.kind === 'image') images += block.text.length
    else texts += block.text.length
  }
  const max = Math.max(tables, equations, images, texts)
  if (max === 0) return 'text'
  if (max === tables) return 'table'
  if (max === equations) return 'equation'
  if (max === images) return 'figure'
  return 'text'
}

/** 给 kinds 一个稳定顺序，便于测试与 UI 展示。 */
export const BLOCK_KIND_ORDER: readonly BlockKind[] = [
  'title', 'text', 'list', 'table', 'equation', 'image', 'code', 'other',
]
