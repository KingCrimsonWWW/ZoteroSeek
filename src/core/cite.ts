/**
 * 引用格式化：作者-年份 / 数字编号 / BibTeX / 完整参考文献行。
 *
 * 刻意自己实现而不是把 Zotero 的导出直接丢给用户，原因：
 * - 面板里勾选几条就要立刻拿到行内引用（`(Liang et al., 2026)`），不需要等导出；
 * - 中文文献的作者名要按「姓 + 名」处理，"Liang, Shichuan" 与 "王, 浩东" 都成立；
 * - 字段缺失（无年份/无作者/无期刊）时有确定的降级规则，而不是拼出半个空字符串。
 * BibTeX 例外：条目导出直接走 Zotero 本地 API（`?format=bibtex`），那是权威输入。
 */
import type { ZoteroItem } from './types.ts'

export type CitationFormat = 'author-year' | 'numeric' | 'reference' | 'bibtex'

/** 从 "Last, First" 里取姓；中文姓名也适用（姓在前）。 */
export function familyName(creator: string): string {
  const comma = creator.indexOf(',')
  if (comma >= 0) return creator.slice(0, comma).trim()
  return creator.trim().split(/\s+/).pop() ?? creator.trim()
}

/** 作者串：(Liang et al., 2026) / (Liang & Li, 2026) / (Liang, 2026) / (n.d.)。 */
export function inlineAuthorYear(item: ZoteroItem): string {
  const families = item.creators.map(familyName).filter((name) => name.length > 0)
  const year = item.year === null ? 'n.d.' : String(item.year)
  if (families.length === 0) return `(无作者, ${year})`
  if (families.length === 1) return `(${families[0]}, ${year})`
  if (families.length === 2) return `(${families[0]} & ${families[1]}, ${year})`
  return `(${families[0]} et al., ${year})`
}

/** 参考文献行：作者. (年份). 标题. 期刊, 卷(期), 页. DOI。缺什么省什么。 */
export function referenceLine(item: ZoteroItem): string {
  const parts: string[] = []
  const authors = item.creators.join('; ')
  if (authors.length > 0) parts.push(endsWithPeriod(authors))
  parts.push(endsWithPeriod(item.year === null ? 'n.d.' : `(${item.year})`))
  parts.push(endsWithPeriod(item.title))
  const journal = item.publicationTitle
  if (journal !== null && journal.length > 0) parts.push(endsWithPeriod(journal))
  if (item.doi !== null && item.doi.length > 0) parts.push(`https://doi.org/${item.doi}`)
  return parts.join(' ')
}

/** 最小可用的 BibTeX 兜底（Zotero 导出不可用时才用）。 */
export function fallbackBibtex(item: ZoteroItem): string {
  const key = item.citationKey ?? `zotero_${item.key}`
  const authors = item.creators
    .map((creator) => creator.replace(/^([^,]+),\s*(.+)$/, '$2 $1'))
    .join(' and ')
  const fields: Array<[string, string | null]> = [
    ['title', `{${item.title}}`],
    ['author', authors.length === 0 ? null : authors],
    ['journal', item.publicationTitle],
    ['year', item.year === null ? null : String(item.year)],
    ['doi', item.doi],
  ]
  const body = fields
    .filter((field): field is [string, string] => field[1] !== null && field[1].length > 0)
    .map(([name, value]) => `  ${name} = {${value.replace(/^\{|\}$/g, '')}},`)
    .join('\n')
  return `@article{${key},\n${body}\n}`
}

/**
 * 一条命中的引用文本（面板「复制引用」用）。
 * @param index 0 起的序号，numeric 格式用。
 */
export function formatCitation(item: ZoteroItem, format: CitationFormat, index = 0): string {
  switch (format) {
    case 'author-year':
      return inlineAuthorYear(item)
    case 'numeric':
      return `[${index + 1}]`
    case 'reference':
      return referenceLine(item)
    case 'bibtex':
      return fallbackBibtex(item)
  }
}

/** 面板里「勾选几条 → 拼成一段引用」的默认形态：行内引用 + 参考文献表。 */
export function formatCitationBundle(
  items: readonly ZoteroItem[],
  format: CitationFormat,
): string {
  if (format === 'bibtex') return items.map(fallbackBibtex).join('\n\n')
  return items.map((item, index) => formatCitation(item, format, index)).join('\n')
}

function endsWithPeriod(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`
}
