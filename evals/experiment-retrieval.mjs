/**
 * 检索策略对照实验（离线、可复现）。
 *
 *   node evals/experiment-retrieval.mjs
 *
 * 指标：
 *   hit@5 —— 该题 top-5 里出现 gold chunk 的题目比例（单题检索成功率）
 *   MRR   —— gold chunk 名次倒数均值
 *
 * 变体：纯词面 / 混合 / +准入 / +问句核心化 / +英文词干归一 / 组合
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

/** 问句核心化：去掉疑问词与元话语，只留内容词。 */
const ZH_FILLER = ['为什么', '为何', '如何', '怎么', '哪些', '哪种', '哪几', '哪一种', '是否', '有没有', '请问', '什么', '多少', '几个', '分别', '作者', '文中', '本文', '主要', '以及', '并且', '但是', '因此', '所以']
const EN_FILLER = ['why', 'how', 'what', 'where', 'when', 'who', 'does', 'did', 'do', 'according', 'authors', 'author', 'paper', 'study', 'article', 'mentioned', 'described', 'proposed', 'respectively']

export function coreQuery(query) {
  let text = query
  for (const word of ZH_FILLER) text = text.split(word).join(' ')
  return text
    .split(/(\s+|[，。！？；：、,.!?;:()（）"“”''])/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !/^[，。！？；：、,.!?;:()（）"“”'']+$/.test(token))
    .filter((token) => !EN_FILLER.includes(token.toLowerCase()))
    .join(' ')
}

/** 英文轻量词干：只处理复数与常见后缀，规则保守（不改 analysis / stress 这类词）。 */
export function stemWord(word) {
  if (word.length <= 4) return word
  if (/(ss|us|is|as)$/.test(word)) return word
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`
  if (/(ches|shes|xes|ses)$/.test(word)) return word.slice(0, -2)
  if (/s$/.test(word)) return word.slice(0, -1)
  if (/ing$/.test(word) && word.length >= 7) return word.slice(0, -3)
  if (/ed$/.test(word) && word.length >= 6) return word.slice(0, -2)
  return word
}

/** 文本归一：连字符当分隔符，英文词做轻量词干。 */
export function normalizeText(text) {
  return text
    .replace(/[‐‑–—]/g, '-')
    .replace(/([A-Za-z])-([A-Za-z])/g, '$1 $2')
    .replace(/[A-Za-z]+/g, (word) => stemWord(word.toLowerCase()))
}

const indexCache = new Map()
function indexFor(itemKey, chunksByItem, titleWeight, normalize) {
  const key = `${itemKey}|${titleWeight}|${normalize ? 'n' : 'r'}`
  const cached = indexCache.get(key)
  if (cached !== undefined) return cached
  const bm25 = new Bm25Index({ titleWeight })
  bm25.build((chunksByItem.get(itemKey) ?? []).map((chunk) => ({
    id: chunk.chunkId,
    title: normalize ? normalizeText(chunk.title) : chunk.title,
    section: normalize ? normalizeText(chunk.sectionPath ?? '') : (chunk.sectionPath ?? ''),
    text: normalize ? normalizeText(chunk.text) : chunk.text,
  })))
  indexCache.set(key, bm25)
  return bm25
}

function evaluate(rows, chunksByItem, options) {
  const { mode, core = false, admission = false, expandedWeight = 0.9, k = 10, titleWeight = 3, normalize = false } = options
  let hits = 0
  let reciprocal = 0
  let scored = 0
  for (const row of rows) {
    if (!chunksByItem.has(row.item_key)) continue
    scored += 1
    const bm25 = indexFor(row.item_key, chunksByItem, titleWeight, normalize)
    const raw = core ? coreQuery(row.q) : row.q
    const query = normalize ? normalizeText(raw) : raw
    if (query.trim().length === 0) continue
    const lexical = bm25.search(query, 100)
    let expanded = []
    let admitted = null
    if (mode === 'hybrid') {
      const expansion = expandQuery(query)
      if (expansion.added.length > 0) {
        expanded = bm25.search(expansion.expandedQuery, 100)
        if (admission) {
          const lexicalIds = new Set(lexical.map((hit) => hit.id))
          const only = expanded
            .filter((hit) => !lexicalIds.has(hit.id))
            .map((hit) => ({ id: hit.id, score: hit.score, matched: hit.matched }))
          const outcome = admitCandidates(
            only,
            { minCoverage: 0.4, margin: 0.5 },
            coverageDenominatorOf(expansion.added.length),
          )
          admitted = new Set([...lexicalIds, ...outcome.admitted.map((candidate) => candidate.id)])
        }
      }
    }
    const lists = []
    if (lexical.length > 0) lists.push({ ids: lexical.map((hit) => hit.id), weight: 1 })
    const expandedIds = expanded.filter((hit) => admitted === null || admitted.has(hit.id)).map((hit) => hit.id)
    if (expandedIds.length > 0) lists.push({ ids: expandedIds, weight: expandedWeight })
    const ranked = lists.length === 0 ? [] : fuseRrf(lists, { k, topK }).map((hit) => hit.id)
    const position = ranked.findIndex((id) => id === row.gold_chunk_id)
    if (position >= 0 && position < topK) hits += 1
    reciprocal += position >= 0 ? 1 / (position + 1) : 0
  }
  return {
    questions: scored,
    hit: Number((hits / Math.max(1, scored)).toFixed(4)),
    mrr: Number((reciprocal / Math.max(1, scored)).toFixed(4)),
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
    ['lexical（纯词面）', { mode: 'lexical' }],
    ['hybrid（无准入）', { mode: 'hybrid' }],
    ['hybrid+准入', { mode: 'hybrid', admission: true }],
    ['hybrid+准入+核心化', { mode: 'hybrid', admission: true, core: true }],
    ['hybrid+准入+词干', { mode: 'hybrid', admission: true, normalize: true }],
    ['hybrid+准入+词干+核心化', { mode: 'hybrid', admission: true, normalize: true, core: true }],
    ['core+词干+扩展权重1.0', { mode: 'hybrid', admission: true, normalize: true, core: true, expandedWeight: 1 }],
  ]

  console.log(['变体'.padEnd(26), ...setsData.map((set) => set.name.padStart(9)), ' 平均hit'.padStart(9), ' 平均MRR'.padStart(9)].join(''))
  const table = []
  for (const [label, options] of variants) {
    const cols = setsData.map((set) => evaluate(set.rows, chunksByItem, options))
    const overall = evaluate(allRows, chunksByItem, options)
    table.push({ label, cols, overall })
    console.log(
      label.padEnd(26),
      ...cols.map((col) => `${(col.hit * 100).toFixed(1)}%`.padStart(9)),
      `${(overall.hit * 100).toFixed(1)}%`.padStart(9),
      overall.mrr.toFixed(4).padStart(9),
    )
  }

  const baseline = table[0].overall
  const best = table.slice().sort((a, b) => b.overall.hit - a.overall.hit || b.overall.mrr - a.overall.mrr)[0]
  console.log(`\n基线（纯词面）：hit@5=${(baseline.hit * 100).toFixed(1)}%  MRR=${baseline.mrr.toFixed(4)}  题数=${allRows.length}`)
  console.log(`最佳：${best.label}  hit@5=${(best.overall.hit * 100).toFixed(1)}%  MRR=${best.overall.mrr.toFixed(4)}`)
  console.log(`提升：${((best.overall.hit - baseline.hit) * 100).toFixed(1)} 个百分点`)
}

await main()
