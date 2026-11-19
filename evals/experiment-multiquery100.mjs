/**
 * 100 题检索成功率对照：单查询 vs 多查询检索（Multi-Query Retrieval）。
 *
 *   node evals/experiment-multiquery100.mjs
 *
 * 数据：
 *   - 既有 53 题（同语言 25、中→英 14、英→中 14），同语言题用「同义改写」变体，
 *     跨语言题用「目标语言翻译」变体；
 *   - 新增 47 题（evals/qa-set-100.jsonl），每题自带目标语言变体；
 *   合计 100 题。
 *
 * 指标：hit@5（top-5 是否含 gold chunk）、MRR；配对 McNemar 精确检验。
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

/** 既有跨语言题的目标语言翻译变体。 */
const CROSS_VARIANTS = {
  x01: ['Why did the authors use the thin-plate equation instead of the thick-plate model to describe the track slab under hammer impact?'],
  x02: ['What were the measurement grid spacing and the number of measurement points in the validation experiment?'],
  x03: ['Which three characteristic parameters did the authors propose to describe the vibration characteristics of the track slab under different void sizes?'],
  x04: ['In what void size range does the track slab service performance deteriorate and require timely detection?'],
  x05: ['What research gap about asymmetric double-arch tunnels is pointed out in the abstract?'],
  x06: ['Why are double-arch tunnels considered more advantageous in mountainous areas?'],
  x07: ['What backfill materials for void defects are listed in Table 5, and what grouting pressure range is recommended for small voids?'],
  x08: ['Why is effective contact between rock mass and lining the basis for repairing void defects, and how does backfill grouting achieve it?'],
  x09: ['Why is rock bolt reinforcement also needed when repairing void defects?'],
  x10: ['What are the advantages of FRP materials for tunnel defect repair, and how is FRP mesh fixed to concrete?'],
  x11: ['What frequency range of acoustic excitation is used in non-contact acoustic-vibration detection, and which two excitation modes were used to design four signals?'],
  x12: ['What are the differences between stepped single-frequency sweep excitation and linear frequency modulation excitation in response stability and band coverage?'],
  x13: ['What were the sizes of the concrete specimen and artificial layer used in the comparative excitation experiment, and what surface sound pressure level was maintained?'],
  x14: ['What misjudgment occurs before reverse-time migration imaging if band-pass filtering is not used to remove seam clutter?'],
  h01: ['对于直径 300 mm、深度 20 mm 的圆形空洞，在混凝土表面识别到的弯曲共振频率是多少？'],
  h02: ['振动速度在空洞区域内外是如何分布的？'],
  h03: ['试件 III 中四个空洞所用的填充材料、密度和边长分别是多少？'],
  h04: ['深度 20 mm、50 mm、80 mm 的空洞测得的特征频率是多少，与仿真偏差多大？'],
  h05: ['可变帧长 MFCC 达到的准确率是多少，比传统 MFCC 高多少？'],
  h06: ['使用改进 MFCC 特征时，AcrcNet 分类器相比 SVM 在分类准确率和 F1 上提升了多少？'],
  h07: ['PTFMSAN 在隧道衬砌空洞检测中达到的最高准确率是多少，相比 AcrcNet 提升了多少？'],
  h08: ['表 5-4 在比较单尺度与多尺度动态卷积准确率时显示了什么？'],
  h09: ['超声回波法与冲击回波法在混凝土缺陷检测中的主要局限是什么？'],
  h10: ['气动脉冲激励装置能产生多大峰值压力，能在什么深度范围内定位缺陷？'],
  h11: ['截至 2023 年末中国公路总里程是多少，隧道养护趋势如何？'],
  h12: ['处理加速度计振动信号用了哪种分解重构算法，用什么阈值对小波系数做筛选？'],
  h13: ['为什么超声波检测难以用于大规模隧道检测，文中还提到哪些无损检测方法？'],
  h14: ['引入频率动态卷积、改进注意力和多尺度特征提取，是为了解决二维卷积的哪些问题？'],
}

/** 既有同语言题的同义改写变体（不改变问题含义）。 */
const SAME_LANG_VARIANTS = {
  q01: ['Why was the thin-plate equation chosen rather than the thick-plate model for describing the track slab subjected to hammer impact?'],
  q02: ['What were the grid spacing and the number of measurement points in the validation test?'],
  q03: ['What are the three characteristic parameters proposed for describing the track slab vibration characteristics under different void sizes?'],
  q04: ['Which range of void extents is said to degrade the service performance of ballastless tracks and therefore needs timely detection?'],
  q05: ['What research gap about asymmetric double-arch tunnels is stated in the abstract?'],
  q06: ['According to the introduction, why are double-arch tunnels regarded as advantageous in mountainous regions?'],
  q07: ['Why do voids behind linings endanger tunnel structural safety, and what numerical approaches were mostly used earlier to investigate them?'],
  q08: ['According to Table 5, what backfill materials are used for void defects, and what grouting pressure is suggested for small voids?'],
  q09: ['Why does effective rock mass-lining contact form the basis for repairing void defects, and how is it achieved by backfill grouting?'],
  q10: ['Why is bolt reinforcement also required, in addition to backfilling, when repairing a void defect?'],
  q11: ['What are the advantages of FRP materials for repairing tunnel defects, and how are FRP grids anchored to concrete?'],
  q12: ['Which acoustic excitation frequency band was applied, and how many excitation signals were designed from which two modes?'],
  q13: ['Which four steps make up the testing procedure of the non-contact acoustic-vibration detection system?'],
  q14: ['How do stepped-tone sweep excitation and linear chirp excitation differ in response stability and frequency coverage?'],
  q15: ['In the comparative excitation test, what sizes of concrete specimen and artificial delamination were adopted, and how was the surface sound pressure level regulated?'],
  q16: ['If the BPF is not applied to remove subgrade joint clutter before reverse-time migration, what misinterpretation may appear in the image?'],
  q17: ['当空洞直径取 300 mm 时，混凝土表面的弯曲共振频率约为多少？振动速度在空洞区域内如何分布？'],
  q18: ['随着检测距离增大，空洞混凝土表面的振动振幅与共振频率各自如何变化？'],
  q19: ['空洞深度分别为 20、50、80 mm 时，试验得到的弯曲振动特征频率是多少？与数值模拟的相对偏差多大？'],
  q20: ['第三章试件Ⅲ的四个人工空洞分别采用什么填充材料？厚度与边长各是多少？'],
  q21: ['变帧长 MFCC 在多少维时效果最佳？对应准确率是多少？比传统 MFCC 提高多少？'],
  q22: ['使用改进 MFCC 特征时，AcrcNet 分类器相比 SVM 在分类准确率与 F1 上平均提高了多少？'],
  q23: ['PTFMSAN 用于隧道衬砌空洞检测的最优准确率是多少？比 AcrcNet 提高多少？'],
  q24: ['表 5-4 对单尺度与多尺度动态卷积分类准确率的比较说明了什么？'],
  q25: ['论文为何同时用锤击激励和远程声波激励下的 LDV 检测来验证声波激励的可行性？'],
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

function mergeMax(target, hits) {
  for (const hit of hits) {
    const prev = target.get(hit.id)
    if (prev === undefined) {
      target.set(hit.id, { score: hit.score, matched: [...hit.matched] })
      continue
    }
    target.set(hit.id, {
      score: Math.max(prev.score, hit.score),
      matched: [...new Set([...prev.matched, ...hit.matched])],
    })
  }
}

function rankRow(row, bm25, useVariants) {
  const phrasings = [row.q, ...(useVariants && row.variant ? [row.variant] : [])]
  const lexicalMap = new Map()
  const expandedMap = new Map()
  const expansions = []
  for (const phrasing of phrasings) {
    if (typeof phrasing !== 'string') throw new Error('bad phrasing for ' + row.id + ': ' + JSON.stringify(phrasing))
    mergeMax(lexicalMap, bm25.search(phrasing, 100))
    const expansion = expandQuery(phrasing)
    if (expansion.added.length > 0) {
      expansions.push(expansion)
      mergeMax(expandedMap, bm25.search(expansion.expandedQuery, 100))
    }
  }
  const lexicalIds = new Set(lexicalMap.keys())
  const only = [...expandedMap.entries()]
    .filter(([id]) => !lexicalIds.has(id))
    .map(([id, value]) => ({ id, score: value.score, matched: value.matched }))
  const terms = new Set(expansions.flatMap((expansion) => expansion.added.map((pair) => pair.to)))
  const outcome = admitCandidates(only, { minCoverage: 0.4, margin: 0.5 }, coverageDenominatorOf(terms.size))
  const admitted = new Set([...lexicalIds, ...outcome.admitted.map((candidate) => candidate.id)])
  const lists = []
  const lexicalRanked = [...lexicalMap.entries()].sort((a, b) => b[1].score - a[1].score)
  if (lexicalRanked.length > 0) lists.push({ ids: lexicalRanked.map(([id]) => id), weight: 1 })
  const expandedRanked = [...expandedMap.entries()].filter(([id]) => admitted.has(id)).sort((a, b) => b[1].score - a[1].score)
  if (expandedRanked.length > 0) lists.push({ ids: expandedRanked.map(([id]) => id), weight: 0.9 })
  const ranked = lists.length === 0 ? [] : fuseRrf(lists, { k: 10, topK }).map((hit) => hit.id)
  const position = ranked.findIndex((id) => id === row.gold_chunk_id)
  return { hit: position >= 0 && position < topK, rank: position >= 0 ? position + 1 : 0 }
}

function evaluate(rows, chunksByItem, useVariants) {
  let hits = 0
  let reciprocal = 0
  const perRow = []
  for (const row of rows) {
    if (!chunksByItem.has(row.item_key)) continue
    const result = rankRow(row, indexFor(row.item_key, chunksByItem), useVariants)
    if (result.hit) hits += 1
    reciprocal += result.rank > 0 ? 1 / result.rank : 0
    perRow.push({ id: row.id, ...result })
  }
  const n = perRow.length
  return { n, hit: hits / Math.max(1, n), mrr: reciprocal / Math.max(1, n), perRow }
}

function mcnemarExact(a, b) {
  // a、b 为同一批题的布尔命中数组
  let discordant = 0
  let aOnly = 0
  let bOnly = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue
    discordant += 1
    if (a[i]) aOnly += 1
    else bOnly += 1
  }
  if (discordant === 0) return { discordant, p: 1 }
  // 精确二项：2 * P(X <= min(aOnly,bOnly))，n=discordant, p=0.5
  const k = Math.min(aOnly, bOnly)
  let tail = 0
  let choose = 1
  for (let i = 0; i <= k; i += 1) {
    tail += choose * (0.5 ** discordant)
    choose = (choose * (discordant - i)) / (i + 1)
  }
  return { discordant, p: Math.min(1, 2 * tail) }
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`
}

async function main() {
  const indexJson = JSON.parse(await readFile(join(dataDir, 'index.json'), 'utf8'))
  const chunksByItem = new Map()
  for (const chunk of indexJson.chunks) {
    if (chunk.source === 'meta') continue
    if (!chunksByItem.has(chunk.itemKey)) chunksByItem.set(chunk.itemKey, [])
    chunksByItem.get(chunk.itemKey).push(chunk)
  }

  const load = async (path) => (await readFile(resolve(path), 'utf8'))
    .split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line))

  const firstVariant = (value) => Array.isArray(value) ? value[0] : value
  const same = (await load('evals/qa-set.jsonl')).map((row) => ({ ...row, variant: firstVariant(SAME_LANG_VARIANTS[row.id]) }))
  const cross = (await load('evals/qa-set-cross.jsonl')).map((row) => ({ ...row, variant: CROSS_VARIANTS[row.id]?.[0] }))
  const holdout = [
    ...(await load('evals/qa-set-holdout.jsonl')),
    ...(await load('evals/qa-set-holdout2.jsonl')),
  ].map((row) => ({ ...row, variant: CROSS_VARIANTS[row.id]?.[0] }))
  const fresh = (await load('evals/qa-set-100.jsonl')).map((row) => ({ id: row.id, q: row.q, item_key: row.item, gold_chunk_id: row.gold, variant: firstVariant(row.v) }))
  const rows = [...same, ...cross, ...holdout, ...fresh]

  const slices = [
    ['既有 53', [...same, ...cross, ...holdout]],
    ['新增 47', fresh],
    ['同语言 25', same],
    ['中→英 38', [...cross, ...fresh.filter((row) => ['EHC5UR3B', 'GUW7QDMH', 'W5QY3SIH'].includes(row.item_key))]],
    ['英→中 37', [...holdout, ...fresh.filter((row) => ['EVRF6GD8', 'HG4N8X9X'].includes(row.item_key))]],
    ['全部 100', rows],
  ]

  console.log('场景'.padEnd(14), '题数'.padStart(5), '单查询 hit@5'.padStart(13), '多查询 hit@5'.padStart(13), '单查询 MRR'.padStart(11), '多查询 MRR'.padStart(11), 'McNemar p'.padStart(11))
  for (const [name, sliceRows] of slices) {
    const single = evaluate(sliceRows, chunksByItem, false)
    const multi = evaluate(sliceRows, chunksByItem, true)
    const a = single.perRow.map((row) => row.hit)
    const b = multi.perRow.map((row) => row.hit)
    const test = mcnemarExact(a, b)
    console.log(
      name.padEnd(14),
      `${single.n}`.padStart(5),
      pct(single.hit).padStart(13),
      pct(multi.hit).padStart(13),
      single.mrr.toFixed(4).padStart(11),
      multi.mrr.toFixed(4).padStart(11),
      `${test.p.toFixed(4)}`.padStart(11),
    )
  }
}

await main()
