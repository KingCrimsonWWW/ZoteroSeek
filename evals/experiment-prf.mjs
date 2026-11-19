/**
 * 伪相关反馈（PRF）对照实验：不做翻译，用首轮结果的词汇做二次检索。
 *
 *   node evals/experiment-prf.mjs
 *
 * 流程：
 *   1. 首轮：两路（词面 + 词表扩展）+ 准入，取 top-3；
 *   2. 从 top-3 片段里抽高频 bigram/英文词（排除原查询已有的词与虚词）；
 *   3. 二次检索：原查询 + 反馈词，再与首轮结果做 RRF；
 *   4. 比较 hit@5 / MRR。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Bm25Index, tokenize } from '../src/core/bm25.ts'
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

function firstPass(bm25, query) {
  const lexical = bm25.search(query, 100)
  const expansion = expandQuery(query)
  const expanded = expansion.added.length > 0 ? bm25.search(expansion.expandedQuery, 100) : []
  const lexicalIds = new Set(lexical.map((hit) => hit.id))
  const only = expanded.filter((hit) => !lexicalIds.has(hit.id)).map((hit) => ({ id: hit.id, score: hit.score, matched: hit.matched }))
  const outcome = admitCandidates(only, { minCoverage: 0.4, margin: 0.5 }, coverageDenominatorOf(expansion.added.length))
  const admitted = new Set([...lexicalIds, ...outcome.admitted.map((candidate) => candidate.id)])
  const lists = []
  if (lexical.length > 0) lists.push({ ids: lexical.map((hit) => hit.id), weight: 1 })
  const expandedIds = expanded.filter((hit) => admitted.has(hit.id)).map((hit) => hit.id)
  if (expandedIds.length > 0) lists.push({ ids: expandedIds, weight: 0.9 })
  const fused = lists.length === 0 ? [] : fuseRrf(lists, { k: 10, topK: 20 })
  const byId = new Map([...lexical, ...expanded].map((hit) => [hit.id, hit]))
  return { lexical, expansion, fused, byId }
}

const PRF_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has', 'have', 'can', 'not', 'which', 'their', 'its', '图', '表', '第', '章', '节'])

function feedbackTerms(chunks, exclude) {
  const counts = new Map()
  for (const chunk of chunks) {
    if (chunk === undefined || typeof chunk.text !== 'string') continue
    const seen = new Set()
    for (const token of tokenize(chunk.text)) {
      if (token.length < 2 || PRF_STOP.has(token) || exclude.has(token)) continue
      if (seen.has(token)) continue
      seen.add(token)
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token)
}

function evaluate(rows, chunksByItem, usePrf) {
  let hits = 0
  let reciprocal = 0
  let scored = 0
  for (const row of rows) {
    if (!chunksByItem.has(row.item_key)) continue
    scored += 1
    const bm25 = indexFor(row.item_key, chunksByItem)
    const pass1 = firstPass(bm25, row.q)
    let ranked = pass1.fused.map((hit) => hit.id)
    if (usePrf && pass1.fused.length > 0) {
      const topChunks = pass1.fused.slice(0, 3).map((hit) => pass1.byId.get(hit.id)).filter(Boolean)
      const exclude = new Set(tokenize(row.q))
      const terms = feedbackTerms(topChunks, exclude)
      if (terms.length > 0) {
        const pass2 = bm25.search(`${row.q} ${terms.join(' ')}`, 100)
        const fused = fuseRrf([
          { ids: ranked, weight: 1 },
          { ids: pass2.map((hit) => hit.id), weight: 0.6 },
        ], { k: 10, topK })
        ranked = fused.map((hit) => hit.id)
      }
    }
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

  console.log('场景'.padEnd(16), '基线 hit@5'.padStart(10), 'PRF hit@5'.padStart(10), '基线 MRR'.padStart(10), 'PRF MRR'.padStart(10))
  for (const { name, rows } of setsData) {
    const base = evaluate(rows, chunksByItem, false)
    const prf = evaluate(rows, chunksByItem, true)
    console.log(name.padEnd(16), `${(base.hit * 100).toFixed(1)}%`.padStart(10), `${(prf.hit * 100).toFixed(1)}%`.padStart(10), base.mrr.toFixed(4).padStart(10), prf.mrr.toFixed(4).padStart(10))
  }
  const baseAll = evaluate(allRows, chunksByItem, false)
  const prfAll = evaluate(allRows, chunksByItem, true)
  console.log('-'.repeat(58))
  console.log('全部 53 题'.padEnd(16), `${(baseAll.hit * 100).toFixed(1)}%`.padStart(10), `${(prfAll.hit * 100).toFixed(1)}%`.padStart(10), baseAll.mrr.toFixed(4).padStart(10), prfAll.mrr.toFixed(4).padStart(10))
  console.log(`\n提升：${((prfAll.hit - baseAll.hit) * 100).toFixed(1)} 个百分点（hit@5），MRR ${(prfAll.mrr - baseAll.mrr >= 0 ? '+' : '')}${(prfAll.mrr - baseAll.mrr).toFixed(4)}`)
}

await main()
