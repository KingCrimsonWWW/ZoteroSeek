/**
 * 扩展路准入的离线标定（覆盖率版）。
 *
 *   node evals/calibrate-admission.mjs [--qa 文件…] [--out-dir evals/reports] [--top-k 5]
 *
 * 与 eval 一致的**单篇内**范围：
 *   覆盖率 = 命中的扩展词数 / min(8, 扩展词总数)
 *   分数阈值 = best * (1 - margin)
 *
 * 1. 正例：金标片段的覆盖率与分数；
 * 2. 对照组：删掉金标片段后，同一扩展查询的最高覆盖率/分数（answer-removed）；
 * 3. 扫描 minCoverage × margin，重放「词面 + 准入后的扩展路」RRF，比较 recall@k / MRR；
 * 4. 跨条目探针：把 A 题问题丢进 B 篇，看无答案时准入能否把扩展路假阳性压下去。
 *
 * 另外记录一次「分数绝对下限」的负结果：BM25 原始分不可跨查询比较，拿分数当 floor
 * 会把金标一起挡掉——这正是 dsh-zotero 的余弦下限不能直接照搬到词面域的原因。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Bm25Index } from '../src/core/bm25.ts'
import { expandQuery } from '../src/core/glossary.ts'
import { fuseRrf } from '../src/core/rrf.ts'
import { coverageDenominatorOf, coverageOf } from '../src/core/admission.ts'
import { Library } from '../src/core/library.ts'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const allArgs = (name) => args.flatMap((value, index) => (value === name && args[index + 1] !== undefined ? [args[index + 1]] : []))

const topK = Number(argOf('--top-k', '5'))
const outDir = argOf('--out-dir', 'evals/reports')
const dataDir = process.env.ZOTEROSEEK_DATA ?? join(homedir(), '.zotero-seek')
const qaPaths = allArgs('--qa')
if (qaPaths.length === 0) qaPaths.push('evals/qa-set.jsonl', 'evals/qa-set-cross.jsonl', 'evals/qa-set-holdout.jsonl', 'evals/qa-set-holdout2.jsonl')

const quantile = (values, q) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[index]
}
const round = (value, digits = 4) => Number(value.toFixed(digits))

function buildIndex(chunks) {
  const bm25 = new Bm25Index()
  bm25.build(chunks.map((chunk) => ({ id: chunk.chunkId, title: chunk.title, section: chunk.sectionPath, text: chunk.text })))
  return bm25
}

function rankFor(lexicalHits, expandedHits, admittedIds) {
  const lists = []
  if (lexicalHits.length > 0) lists.push({ ids: lexicalHits.map((hit) => hit.id), weight: 1 })
  const expanded = expandedHits.filter((hit) => admittedIds === null || admittedIds.has(hit.id))
  if (expanded.length > 0) lists.push({ ids: expanded.map((hit) => hit.id), weight: 0.9 })
  if (lists.length === 0) return []
  return fuseRrf(lists, { k: 10, topK }).map((hit) => hit.id)
}

/** 准入：先按覆盖率筛，再按分数余量筛。 */
function admit(expansionOnly, denominator, minCoverage, margin) {
  const covered = expansionOnly.filter((hit) => coverageOf(hit, denominator) >= minCoverage)
  if (covered.length === 0) return new Set()
  const best = covered.reduce((high, hit) => Math.max(high, hit.score), 0)
  const threshold = best * (1 - margin)
  return new Set(covered.filter((hit) => hit.score >= threshold).map((hit) => hit.id))
}

function replay(row, bm25, minCoverage, margin) {
  const expansion = expandQuery(row.q)
  const expandedQuery = expansion.added.length > 0 ? expansion.expandedQuery : row.q
  const denominator = coverageDenominatorOf(expansion.added.length)
  const lexical = bm25.search(row.q, 100)
  const expanded = bm25.search(expandedQuery, 100)
  const lexicalIds = new Set(lexical.map((hit) => hit.id))
  const expansionOnly = expanded.filter((hit) => !lexicalIds.has(hit.id)).map((hit) => ({ id: hit.id, score: hit.score, matched: hit.matched }))
  const admittedIds = admit(expansionOnly, denominator, minCoverage, margin)
  const ranked = rankFor(lexical, expanded, admittedIds)
  const position = ranked.findIndex((id) => id === row.gold_chunk_id)
  return { rank: position < 0 ? 0 : position + 1, admitted: admittedIds.size, denominator }
}

async function main() {
  const library = await Library.open(dataDir)
  const chunksByItem = new Map()
  for (const item of library.items()) {
    const chunks = library.chunksOf(item.key)
    if (chunks.length > 0) chunksByItem.set(item.key, chunks)
  }
  if (chunksByItem.size === 0) {
    console.error(`索引为空（${dataDir}）。先入库：node evals/ingest.mjs <item_key>…`)
    process.exitCode = 1
    return
  }

  const rows = []
  for (const qaPath of qaPaths) {
    const raw = await readFile(resolve(qaPath), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      rows.push({ ...JSON.parse(trimmed), set: qaPath })
    }
  }

  const indexCache = new Map()
  const scopedIndex = (itemKey, withoutChunkId) => {
    const key = `${itemKey}|${withoutChunkId ?? ''}`
    const cached = indexCache.get(key)
    if (cached !== undefined) return cached
    const bm25 = buildIndex((chunksByItem.get(itemKey) ?? []).filter((chunk) => chunk.chunkId !== withoutChunkId))
    indexCache.set(key, bm25)
    return bm25
  }

  const observations = []
  for (const row of rows) {
    if (!chunksByItem.has(row.item_key)) continue
    const expansion = expandQuery(row.q)
    if (expansion.added.length === 0) continue
    const denominator = coverageDenominatorOf(expansion.added.length)
    const expanded = scopedIndex(row.item_key).search(expansion.expandedQuery, 100)
    const positive = expanded.find((hit) => hit.id === row.gold_chunk_id)
    const control = scopedIndex(row.item_key, row.gold_chunk_id).search(expansion.expandedQuery, 100)
    const controlBest = control.reduce((high, hit) => Math.max(high, coverageOf(hit, denominator)), 0)
    observations.push({
      id: row.id,
      set: row.set,
      terms: expansion.added.length,
      positiveCoverage: positive === undefined ? 0 : coverageOf(positive, denominator),
      controlCoverage: controlBest,
    })
  }

  const positives = observations.map((row) => row.positiveCoverage).filter((value) => value > 0)
  const controls = observations.map((row) => row.controlCoverage)
  const coverageBuckets = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
  const margins = [0.3, 0.5, 0.7, 1]

  const replayAll = (minCoverage, margin) => {
    let hits = 0
    let reciprocal = 0
    let admittedTotal = 0
    let scored = 0
    for (const row of rows) {
      if (!chunksByItem.has(row.item_key)) continue
      scored += 1
      const outcome = replay(row, scopedIndex(row.item_key), minCoverage, margin)
      if (outcome.rank > 0 && outcome.rank <= topK) hits += 1
      reciprocal += outcome.rank > 0 ? 1 / outcome.rank : 0
      admittedTotal += outcome.admitted
    }
    return {
      recall: round(hits / Math.max(1, scored)),
      mrr: round(reciprocal / Math.max(1, scored)),
      admittedPerQuery: round(admittedTotal / Math.max(1, scored), 2),
    }
  }

  const baseline = { minCoverage: 0, margin: 1 }
  const base = replayAll(baseline.minCoverage, baseline.margin)
  const table = []
  for (const minCoverage of coverageBuckets) {
    for (const margin of margins) {
      const metrics = replayAll(minCoverage, margin)
      table.push({ minCoverage, margin, ...metrics, dRecall: round(metrics.recall - base.recall), dMrr: round(metrics.mrr - base.mrr) })
    }
  }
  const eligible = table.filter((row) => row.recall >= base.recall)
  const best = (eligible.length > 0 ? eligible : table).sort((a, b) => b.mrr - a.mrr || b.recall - a.recall)[0]

  // 跨条目探针：无答案问题的非空结果比例（越小越好）。
  const probeRows = rows.slice(0, 12)
  const probeItems = [...chunksByItem.keys()]
  let probeTotal = 0
  let probeBase = 0
  let probeAdmitted = 0
  for (const [index, row] of probeRows.entries()) {
    const otherItem = probeItems[(index + 1) % probeItems.length]
    if (otherItem === row.item_key) continue
    const expansion = expandQuery(row.q)
    if (expansion.added.length === 0) continue
    const denominator = coverageDenominatorOf(expansion.added.length)
    const bm25 = scopedIndex(otherItem)
    const lexical = bm25.search(row.q, 20)
    const expanded = bm25.search(expansion.expandedQuery, 20)
    probeTotal += 1
    if (rankFor(lexical, expanded, null).length > 0) probeBase += 1
    const lexicalIds = new Set(lexical.map((hit) => hit.id))
    const expansionOnly = expanded.filter((hit) => !lexicalIds.has(hit.id)).map((hit) => ({ id: hit.id, score: hit.score, matched: hit.matched }))
    if (rankFor(lexical, expanded, admit(expansionOnly, denominator, best.minCoverage, best.margin)).length > 0) probeAdmitted += 1
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'item',
    dataDir,
    qaSets: qaPaths,
    questions: rows.length,
    observed: observations.length,
    distributions: {
      positiveCoverage: { count: positives.length, min: round(Math.min(...positives), 3), p50: round(quantile(positives, 0.5), 3), p90: round(quantile(positives, 0.9), 3), max: round(Math.max(...positives), 3) },
      controlCoverage: { p50: round(quantile(controls, 0.5), 3), p75: round(quantile(controls, 0.75), 3), p90: round(quantile(controls, 0.9), 3), p95: round(quantile(controls, 0.95), 3), max: round(Math.max(...controls), 3) },
    },
    baseline: { ...baseline, ...base },
    recommended: { minCoverage: best.minCoverage, margin: best.margin, recall: best.recall, mrr: best.mrr, admittedPerQuery: best.admittedPerQuery },
    probe: { queries: probeTotal, baselineNonEmpty: probeBase, admittedNonEmpty: probeAdmitted },
    negativeResult: 'BM25 原始分不可跨查询比较：把分数当绝对下限会把金标片段一起挡掉（见报告 sweep 之外的历史记录）。因此准入门槛用覆盖率，不用分数。',
    sweep: table,
  }

  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, 'admission-calibration.json')
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`题目 ${rows.length} 道，可观测 ${observations.length} 道（单篇内标定）`)
  console.log(`正例覆盖率   p50=${report.distributions.positiveCoverage.p50}  p90=${report.distributions.positiveCoverage.p90}  max=${report.distributions.positiveCoverage.max}`)
  console.log(`对照覆盖率   p50=${report.distributions.controlCoverage.p50}  p75=${report.distributions.controlCoverage.p75}  p90=${report.distributions.controlCoverage.p90}  p95=${report.distributions.controlCoverage.p95}  max=${report.distributions.controlCoverage.max}`)
  console.log(`\n基线（无准入）  recall@${topK}=${base.recall}  MRR=${base.mrr}  扩展路平均放行 ${base.admittedPerQuery} 条`)
  console.log('\nminCov  margin  recall@k   MRR     Δrecall  ΔMRR    放行/题')
  for (const row of table.slice().sort((a, b) => b.mrr - a.mrr).slice(0, 12)) {
    console.log(`${row.minCoverage.toFixed(2)}    ${row.margin.toFixed(2)}   ${row.recall.toFixed(4)}   ${row.mrr.toFixed(4)}  ${row.dRecall >= 0 ? '+' : ''}${row.dRecall}    ${row.dMrr >= 0 ? '+' : ''}${row.dMrr}    ${row.admittedPerQuery}`)
  }
  console.log(`\n推荐：minCoverage=${best.minCoverage}  margin=${best.margin}  recall@${topK}=${best.recall}  MRR=${best.mrr}`)
  console.log(`跨条目探针：无答案问题的非空结果 ${probeBase}/${probeTotal} → 准入后 ${probeAdmitted}/${probeTotal}`)
  console.log(`报告：${outPath}`)
}

await main()
