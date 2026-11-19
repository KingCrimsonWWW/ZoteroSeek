/**
 * 「硬锚点」检索路线的对照实验。
 *
 * 动机：现有两路（词面 + 词表扩展）对「方法名/缩写/表格编号/带单位数值」不敏感——
 * 英文问题问中文论文时，问题里真正可匹配的往往只有 `MFCC`、`PTFMSAN`、`300 mm`、
 * `表 5-4` 这些「硬锚点」，而其余英文词把 BM25 的分数稀释了。
 *
 *   node evals/experiment-anchors.mjs
 *
 * 对比：生产逻辑（两路 + 准入） vs 追加一条「硬锚点路」。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Bm25Index } from '../src/core/bm25.ts'
import { expandQuery } from '../src/core/glossary.ts'
import { fuseRrf } from '../src/core/rrf.ts'
import { admitCandidates, coverageDenominatorOf } from '../src/core/admission.ts'

const dataDir = process.env.ZOTEROSEEK_DATA ?? join(homedir(), '.zotero-seek')
const topK = 5
const sets = [
  ['同语言25', 'evals/qa-set.jsonl'],
  ['中→英14', 'evals/qa-set-cross.jsonl'],
  ['留出8', 'evals/qa-set-holdout.jsonl'],
  ['留出6', 'evals/qa-set-holdout2.jsonl'],
]

/** 常见的句首/疑问大写词，不能当锚点。 */
const EN_ANCHOR_STOP = new Set(['For', 'How', 'What', 'Why', 'The', 'In', 'On', 'If', 'Does', 'Do', 'Which', 'When', 'Where', 'Who', 'Are', 'Is', 'Was', 'Were', 'It', 'This', 'That', 'These', 'Those', 'And', 'Or', 'But', 'With', 'From', 'To', 'At', 'As', 'By', 'Using', 'According', 'Table', 'Figure', 'Fig', 'Tab'])

/** 提取「硬锚点」：缩写/型号、带单位数值、表格图号（中英互换）、引号内容。 */
export function extractAnchors(query) {
  const anchors = []
  const push = (value) => {
    const text = value.trim()
    if (text.length === 0) return
    if (!anchors.some((existing) => existing.toLowerCase() === text.toLowerCase())) anchors.push(text)
  }
  for (const match of query.matchAll(/\b[A-Za-z][A-Za-z0-9-]{1,}\b/g)) {
    const word = match[0]
    if (EN_ANCHOR_STOP.has(word)) continue
    const isAcronym = /^[A-Z0-9-]{2,}$/.test(word) && word.length >= 3
    const hasDigit = /\d/.test(word)
    const isCamel = /^[A-Z][a-z]+[A-Z]/.test(word)
    if (isAcronym || hasDigit || isCamel) push(word)
  }
  for (const match of query.matchAll(/\d+(?:\.\d+)?\s*(?:mm|cm|m|km|Hz|kHz|MHz|MPa|GPa|kg|g|s|ms|°C|%)\b/gi)) {
    push(match[0])
  }
  for (const match of query.matchAll(/(?:Table|Tab\.?|Fig\.?|Figure|表|图)\s*\d+(?:[-–—.]\d+)*/gi)) {
    const ref = match[0].replace(/\s+/g, ' ')
    push(ref)
    const zh = /表|图/.test(ref)
    const num = ref.match(/\d+(?:[-–—.]\d+)*/)?.[0] ?? ''
    if (zh) {
      push(`${/表/.test(ref) ? 'Table' : 'Figure'} ${num}`)
      push(`${/表/.test(ref) ? 'Tab' : 'Fig'} ${num}`)
    } else {
      push(`${/Table|Tab/i.test(ref) ? '表' : '图'} ${num}`)
    }
  }
  for (const match of query.matchAll(/[「“"]([^」”"]{2,30})[」”"]/g)) {
    push(match[1])
  }
  return anchors
}

/** 只有出现「强锚点」才启用这一路：缩写、表格图号、引号内容；纯数字不够。 */
function hasStrongAnchor(anchors) {
  return anchors.some((anchor) => /[A-Za-z]{2,}/.test(anchor) || /^(Table|Tab|Fig|Figure|表|图)/i.test(anchor))
}

const indexCache = new Map()
function indexFor(itemKey, chunksByItem) {
  const cached = indexCache.get(itemKey)
  if (cached !== undefined) return cached
  const bm25 = new Bm25Index()
  bm25.build((chunksByItem.get(itemKey) ?? []).map((chunk) => ({
    id: chunk.chunkId,
    title: chunk.title,
    section: chunk.sectionPath,
    text: chunk.text,
  })))
  indexCache.set(itemKey, bm25)
  return bm25
}

function evaluate(rows, chunksByItem, options = {}) {
  const { useAnchors = false, anchorWeight = 1, admission = true } = options
  let hits = 0
  let reciprocal = 0
  let scored = 0
  let anchorUsed = 0
  for (const row of rows) {
    if (!chunksByItem.has(row.item_key)) continue
    scored += 1
    const bm25 = indexFor(row.item_key, chunksByItem)
    const lexical = bm25.search(row.q, 100)
    const expansion = expandQuery(row.q)
    const expanded = expansion.added.length > 0 ? bm25.search(expansion.expandedQuery, 100) : []
    let admitted = null
    if (admission && expanded.length > 0) {
      const lexicalIds = new Set(lexical.map((hit) => hit.id))
      const only = expanded.filter((hit) => !lexicalIds.has(hit.id)).map((hit) => ({ id: hit.id, score: hit.score, matched: hit.matched }))
      const outcome = admitCandidates(only, { minCoverage: 0.4, margin: 0.5 }, coverageDenominatorOf(expansion.added.length))
      admitted = new Set([...lexicalIds, ...outcome.admitted.map((candidate) => candidate.id)])
    }
    const lists = []
    if (lexical.length > 0) lists.push({ ids: lexical.map((hit) => hit.id), weight: 1 })
    const expandedIds = expanded.filter((hit) => admitted === null || admitted.has(hit.id)).map((hit) => hit.id)
    if (expandedIds.length > 0) lists.push({ ids: expandedIds, weight: 0.9 })

    const anchors = useAnchors ? extractAnchors(row.q) : []
    if (anchors.length > 0 && hasStrongAnchor(anchors)) {
      const anchorHits = bm25.search(anchors.join(' '), 100)
      if (anchorHits.length > 0) {
        lists.push({ ids: anchorHits.map((hit) => hit.id), weight: anchorWeight })
        anchorUsed += 1
      }
    }

    const ranked = lists.length === 0 ? [] : fuseRrf(lists, { k: 10, topK }).map((hit) => hit.id)
    const position = ranked.findIndex((id) => id === row.gold_chunk_id)
    if (position >= 0 && position < topK) hits += 1
    reciprocal += position >= 0 ? 1 / (position + 1) : 0
  }
  return {
    questions: scored,
    hit: Number((hits / Math.max(1, scored)).toFixed(4)),
    mrr: Number((reciprocal / Math.max(1, scored)).toFixed(4)),
    anchorUsed,
  }
}

async function main() {
  const indexJson = JSON.parse(await readFile(join(dataDir, 'index.json'), 'utf8'))
  const chunksByItem = new Map()
  for (const chunk of indexJson.chunks) {
    if (chunk.source === 'meta') continue
    if (!chunksByItem.has(chunk.itemKey)) chunksByItem.set(chunk.itemKey, [])
    chunksByItem.get(chunk.itemKey).push(chunk)
  }

  const setsData = []
  for (const [name, path] of sets) {
    const raw = await readFile(resolve(path), 'utf8')
    const rows = raw.split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line))
    setsData.push({ name, rows })
  }
  const allRows = setsData.flatMap((set) => set.rows)

  const variants = [
    ['两路+准入（基线）', { useAnchors: false }],
    ['+硬锚点路（w=1.0）', { useAnchors: true, anchorWeight: 1 }],
    ['+硬锚点路（w=1.5）', { useAnchors: true, anchorWeight: 1.5 }],
    ['+硬锚点路（w=2.0）', { useAnchors: true, anchorWeight: 2 }],
    ['+硬锚点路（w=0.7）', { useAnchors: true, anchorWeight: 0.7 }],
    ['+硬锚点路（w=1.2）', { useAnchors: true, anchorWeight: 1.2 }],
  ]

  console.log(['变体'.padEnd(22), ...setsData.map((set) => set.name.padStart(9)), ' 平均hit'.padStart(9), ' 平均MRR'.padStart(9), ' 触发'.padStart(6)].join(''))
  const table = []
  for (const [label, options] of variants) {
    const cols = setsData.map((set) => evaluate(set.rows, chunksByItem, options))
    const overall = evaluate(allRows, chunksByItem, options)
    table.push({ label, cols, overall })
    console.log(
      label.padEnd(22),
      ...cols.map((col) => `${(col.hit * 100).toFixed(1)}%`.padStart(9)),
      `${(overall.hit * 100).toFixed(1)}%`.padStart(9),
      overall.mrr.toFixed(4).padStart(9),
      `${overall.anchorUsed}`.padStart(6),
    )
  }

  const base = table[0].overall
  const best = table.slice(1).sort((a, b) => b.overall.hit - a.overall.hit || b.overall.mrr - a.overall.mrr)[0]
  console.log(`\n基线：hit@5=${(base.hit * 100).toFixed(1)}%  MRR=${base.mrr.toFixed(4)}`)
  console.log(`最佳：${best.label}  hit@5=${(best.overall.hit * 100).toFixed(1)}%  MRR=${best.overall.mrr.toFixed(4)}`)
  console.log(`提升：${((best.overall.hit - base.hit) * 100).toFixed(1)} 个百分点（${base.questions} 题）`)
}

await main()
