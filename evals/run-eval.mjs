/**
 * 检索侧评测：只算检索指标，不调用任何模型，可重复、可离线。
 *
 *   node evals/run-eval.mjs [--top-k 5] [--qa evals/qa-set.jsonl] [--out evals/reports]
 *
 * 输入 qa-set.jsonl，每行：
 *   { "id": "q01", "q": "问题", "item_key": "ABCD1234", "gold_chunk_id": "ABCD1234:0012", "type": "fact|method|cross" }
 *
 * 指标：
 *   recall@k  —— gold_chunk_id 出现在 top-k 的题目比例（检索侧，最核心的「有没有找对片段」）
 *   mrr       —— gold_chunk_id 排名的倒数均值（区分「第一页就找到」和「勉强进前五」）
 *   hit_rate  —— 至少返回一条片段的题目比例（衡量「检索是否彻底空转」）
 *
 * 生成侧指标（citation_accuracy / answer_rate）需要模型，由插件内的 zotero_eval 工具产出，
 * 这样可以避免评测脚本自己维护一套模型客户端与密钥。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Library } from '../src/core/library.ts'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const topK = Number(argOf('--top-k', '5'))
const qaPath = argOf('--qa', 'evals/qa-set.jsonl')
const outDir = argOf('--out', 'evals/reports')
const dataDir = process.env.ZOTEROSEEK_DATA ?? join(homedir(), '.zotero-seek')

async function main() {
  const library = await Library.open(dataDir)
  const stats = library.stats()
  if (stats.chunks === 0) {
    console.error(`索引为空（${dataDir}）。先把文献入库：node evals/ingest.mjs <item_key>… 或在面板里点「入库」。`)
    process.exitCode = 1
    return
  }

  const raw = await readFile(qaPath, 'utf8')
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))

  const results = []
  for (const row of rows) {
    const hits = library.search(row.q, { topK, ...(row.item_key === undefined ? {} : { itemKey: row.item_key }) })
    const rank = hits.findIndex((hit) => hit.chunkId === row.gold_chunk_id)
    results.push({
      id: row.id,
      type: row.type ?? 'fact',
      q: row.q,
      gold: row.gold_chunk_id,
      rank: rank < 0 ? null : rank + 1,
      top: hits.map((hit) => hit.chunkId),
    })
  }

  const total = results.length
  const found = results.filter((result) => result.rank !== null)
  const recall = total === 0 ? 0 : found.length / total
  const mrr = total === 0 ? 0 : found.reduce((sum, result) => sum + 1 / (result.rank ?? 0), 0) / total
  const hitRate = total === 0 ? 0 : results.filter((result) => result.top.length > 0).length / total

  const byType = new Map()
  for (const result of results) {
    const bucket = byType.get(result.type) ?? { total: 0, found: 0 }
    bucket.total += 1
    if (result.rank !== null) bucket.found += 1
    byType.set(result.type, bucket)
  }

  const gitSha = safe(() => execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim())
  const qaSha = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  const report = {
    generatedAt: new Date().toISOString(),
    git: gitSha ?? 'unknown',
    qaSet: { path: qaPath, sha256: qaSha, questions: total },
    index: { dataDir, chunks: stats.chunks, parsedItems: stats.parsedItems },
    topK,
    metrics: { [`recall@${topK}`]: round(recall), mrr: round(mrr), hitRate: round(hitRate) },
    byType: Object.fromEntries([...byType].map(([type, bucket]) => [type, {
      total: bucket.total,
      recall: round(bucket.total === 0 ? 0 : bucket.found / bucket.total),
    }])),
    failures: results.filter((result) => result.rank === null || result.rank > 3),
    results,
  }

  await mkdir(outDir, { recursive: true })
  const stamp = report.generatedAt.replace(/[:.]/g, '-')
  const jsonPath = join(outDir, `${stamp}-retrieval.json`)
  const mdPath = join(outDir, `${stamp}-retrieval.md`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(mdPath, renderMarkdown(report), 'utf8')

  console.log(renderMarkdown(report))
  console.log(`\n报告：${jsonPath}\n      ${mdPath}`)
}

function renderMarkdown(report) {
  const lines = []
  lines.push(`# 检索评测报告`)
  lines.push('')
  lines.push(`- 生成时间：${report.generatedAt}`)
  lines.push(`- 代码版本：\`${report.git}\``)
  lines.push(`- 评测集：${report.qaSet.questions} 题（sha256 ${report.qaSet.sha256}）`)
  lines.push(`- 索引：${report.index.chunks} 个分块 / ${report.index.parsedItems} 篇已入库`)
  lines.push(`- 口径：\`top_k = ${report.topK}\`，gold_chunk_id 命中即算 recall`)
  lines.push('')
  lines.push('| 指标 | 数值 |')
  lines.push('|---|---|')
  lines.push(`| recall@${report.topK} | ${report.metrics[`recall@${report.topK}`]} |`)
  lines.push(`| MRR | ${report.metrics.mrr} |`)
  lines.push(`| hit_rate | ${report.metrics.hitRate} |`)
  lines.push('')
  lines.push('| 题型 | 题数 | recall |')
  lines.push('|---|---|---|')
  for (const [type, bucket] of Object.entries(report.byType)) {
    lines.push(`| ${type} | ${bucket.total} | ${bucket.recall} |`)
  }
  if (report.failures.length > 0) {
    lines.push('')
    lines.push('## 未进入前 3 的题')
    lines.push('')
    for (const failure of report.failures) {
      lines.push(`- \`${failure.id}\` ${failure.q} — gold=${failure.gold} rank=${failure.rank ?? '未命中'}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function round(value) {
  return Math.round(value * 10000) / 10000
}

function safe(operation) {
  try {
    return operation()
  } catch {
    return undefined
  }
}

await main()
