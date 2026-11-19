/**
 * 双语问法（query variants）对照实验。
 *
 *   node evals/experiment-variants.mjs
 *
 * 背景：跨语言场景里，单条中文问题检索英文论文（或反过来）只能靠词表扩展；
 * 如果模型/用户同时给出目标语言的另一种问法，检索应显著变好。工具已经支持
 * `query_variants`（≤4 条，逐路打分取最高分），这里量化它值多少。
 *
 * 指标：hit@5（top-5 是否含 gold chunk）、MRR。
 * 对照：单问法（生产当前行为） vs 双问法（原问题 + 目标语言翻译）。
 *
 * 注意：变体是人工翻译，代表“模型能提供的高质量问法”，不是自动生成的；
 * 报告里会把这一点写清楚（这是能力的上界，不是无条件的默认行为）。
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

/** 每条原问题的目标语言问法（人工翻译）。键是题目 id。 */
const VARIANTS = {
  // 中文问 → 英文论文
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
  // 英文问 → 中文论文
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

const sets = [
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

function evaluate(rows, chunksByItem, variantsById) {
  let hits = 0
  let reciprocal = 0
  let scored = 0
  for (const row of rows) {
    if (!chunksByItem.has(row.item_key)) continue
    scored += 1
    const bm25 = indexFor(row.item_key, chunksByItem)
    const phrasings = [row.q, ...(variantsById[row.id] ?? [])]
    const lexicalMap = new Map()
    const expandedMap = new Map()
    const expansions = []
    for (const phrasing of phrasings) {
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
    const expandedRanked = [...expandedMap.entries()]
      .filter(([id]) => admitted.has(id))
      .sort((a, b) => b[1].score - a[1].score)
    if (expandedRanked.length > 0) lists.push({ ids: expandedRanked.map(([id]) => id), weight: 0.9 })

    const ranked = lists.length === 0 ? [] : fuseRrf(lists, { k: 10, topK }).map((hit) => hit.id)
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

  const single = evaluate(allRows, chunksByItem, {})
  const dual = evaluate(allRows, chunksByItem, VARIANTS)
  console.log('场景                  单问法 hit@5   双问法 hit@5   单问法 MRR   双问法 MRR')
  for (const { name, rows } of setsData) {
    const a = evaluate(rows, chunksByItem, {})
    const b = evaluate(rows, chunksByItem, VARIANTS)
    console.log(
      name.padEnd(20),
      `${(a.hit * 100).toFixed(1)}%`.padStart(12),
      `${(b.hit * 100).toFixed(1)}%`.padStart(12),
      a.mrr.toFixed(4).padStart(12),
      b.mrr.toFixed(4).padStart(12),
    )
  }
  console.log('-' .repeat(66))
  console.log(
    '全部（28 题）'.padEnd(20),
    `${(single.hit * 100).toFixed(1)}%`.padStart(12),
    `${(dual.hit * 100).toFixed(1)}%`.padStart(12),
    single.mrr.toFixed(4).padStart(12),
    dual.mrr.toFixed(4).padStart(12),
  )
  console.log(`\n提升：${((dual.hit - single.hit) * 100).toFixed(1)} 个百分点（hit@5），MRR +${(dual.mrr - single.mrr).toFixed(4)}`)
  console.log(`口径：变体是目标语言的人工翻译，代表「模型能提供的高质量问法」；不是自动生成的默认行为。`)
}

await main()
