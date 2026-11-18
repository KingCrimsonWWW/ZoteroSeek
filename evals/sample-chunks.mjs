/**
 * 从索引里抽样出「候选出题片段」，方便人工/模型为评测集标注 gold chunk。
 *
 *   node evals/sample-chunks.mjs [--per-paper 4] [--out evals/qa-candidates.md]
 *
 * 抽样偏好：方法/结果/结论类章节优先（这些地方最值得出「方法: 」「数值: 」题），
 * 每篇文献最多取 per-paper 块，块长控制在 200–900 字符之间（太短出不了题，
 * 太长会让题目指向不明确）。输出带 chunk_id，标注 gold 时直接抄。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../src/core/library.ts'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const perPaper = Number(argOf('--per-paper', '4'))
const outPath = argOf('--out', 'evals/qa-candidates.md')
const dataDir = process.env.ZOTEROSEEK_DATA ?? join(homedir(), '.zotero-seek')

const library = await Library.open(dataDir)
const parsed = library.parsedItems()
const itemKeys = Object.keys(parsed)
if (itemKeys.length === 0) {
  console.error('索引里还没有入库文献。')
  process.exit(1)
}

const preferred = /(method|result|conclusion|approach|experiment|discussion|方法|结果|结论|实验|讨论)/i
const lines = []
lines.push('# 评测集候选片段')
lines.push('')
lines.push(`生成时间：${new Date().toISOString()}`)
lines.push('')
lines.push('每题标注：`gold_chunk_id` 取下面片段自身的 chunk_id；问题必须**能只靠该片段作答**。')
lines.push('')

for (const itemKey of itemKeys) {
  const chunks = library.chunksOf(itemKey)
  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: (preferred.test(chunk.sectionPath) ? 2 : 0)
        + (chunk.text.length >= 200 && chunk.text.length <= 900 ? 2 : 0)
        + (/\d/.test(chunk.text) ? 1 : 0)
        + (chunk.kind === 'table' ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, perPaper)
  const title = chunks[0]?.title ?? itemKey
  lines.push(`## ${itemKey} 《${title}》`)
  lines.push('')
  for (const { chunk } of scored) {
    lines.push(`### ${chunk.chunkId} · ${chunk.sectionPath || '（无章节）'} · 第 ${chunk.page === null ? '?' : chunk.page + 1} 页 · ${chunk.kind}`)
    lines.push('')
    lines.push('```text')
    lines.push(chunk.text.slice(0, 1200))
    lines.push('```')
    lines.push('')
  }
}

await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8')
console.log(`已写出 ${outPath}（${itemKeys.length} 篇 × 最多 ${perPaper} 块）`)
