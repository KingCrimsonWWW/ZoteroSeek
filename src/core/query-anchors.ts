/**
 * 「硬锚点」抽取（检索用）。
 *
 * 问题背景：英文问题问中文论文时，问题里真正能在原文里字面匹配的，往往只有
 * 缩写/型号（MFCC、PTFMSAN、AcrcNet）、带单位的数值（300 mm、2.45 MPa）、
 * 表格/图编号（Table 5-4 / 表 5-4）和引号里的术语；其余英文词会把 BM25 的分数稀释。
 *
 * 抽出这些锚点单独做一路检索，再与词面/扩展两路做 RRF，可提高这类问题的命中率。
 * 只有出现「强锚点」（缩写、表图编号、引号内容）才启用这一路，纯数字不足以触发。
 */
export interface Anchor {
  text: string
  kind: 'acronym' | 'number' | 'ref' | 'quote'
}

/** 句首/疑问大写词，不能当锚点。 */
const EN_STOP = new Set([
  'For', 'How', 'What', 'Why', 'The', 'In', 'On', 'If', 'Does', 'Do', 'Which', 'When',
  'Where', 'Who', 'Are', 'Is', 'Was', 'Were', 'It', 'This', 'That', 'These', 'Those',
  'And', 'Or', 'But', 'With', 'From', 'To', 'At', 'As', 'By', 'Using', 'According',
  'Table', 'Figure', 'Fig', 'Tab', 'A', 'An', 'Of', 'In', 'By',
])

/** 从查询里抽取硬锚点（去重、保持出现顺序）。 */
export function extractAnchors(query: string): Anchor[] {
  const seen = new Set<string>()
  const anchors: Anchor[] = []
  const push = (text: string, kind: Anchor['kind']): void => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    anchors.push({ text: trimmed, kind })
  }

  // 缩写 / 型号 / 驼峰命名
  for (const match of query.matchAll(/\b[A-Za-z][A-Za-z0-9-]{1,}\b/g)) {
    const word = match[0]
    if (EN_STOP.has(word)) continue
    const isAcronym = /^[A-Z0-9-]{2,}$/.test(word) && word.length >= 3
    const hasDigit = /\d/.test(word)
    const isCamel = /^[A-Z][a-z]+[A-Z]/.test(word)
    if (isAcronym || hasDigit || isCamel) push(word, 'acronym')
  }
  // 带单位的数值
  for (const match of query.matchAll(/\d+(?:\.\d+)?\s*(?:mm|cm|m|km|Hz|kHz|MHz|MPa|GPa|kg|g|ms|s|°C|%)/gi)) {
    push(match[0], 'number')
  }
  // 表格 / 图编号，中英互换
  for (const match of query.matchAll(/(?:Table|Tab\.?|Fig\.?|Figure|表|图)\s*\d+(?:[-–—.]\d+)*/gi)) {
    const ref = match[0].replace(/\s+/g, ' ')
    push(ref, 'ref')
    const num = ref.match(/\d+(?:[-–—.]\d+)*/)?.[0] ?? ''
    const isTable = /Table|Tab|表/i.test(ref)
    if (/表|图/.test(ref)) {
      push(`${isTable ? 'Table' : 'Figure'} ${num}`, 'ref')
      push(`${isTable ? 'Tab' : 'Fig'} ${num}`, 'ref')
    } else {
      push(`${isTable ? '表' : '图'} ${num}`, 'ref')
    }
  }
  // 引号内容
  for (const match of query.matchAll(/[「“"]([^」”"]{2,30})[」”"]/g)) {
    push(match[1] ?? '', 'quote')
  }
  return anchors
}

/** 是否含强锚点：缩写、表图编号、引号内容；纯数值不算。 */
export function hasStrongAnchor(anchors: readonly Anchor[]): boolean {
  return anchors.some((anchor) => anchor.kind === 'acronym' || anchor.kind === 'ref' || anchor.kind === 'quote')
}
