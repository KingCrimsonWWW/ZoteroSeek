/**
 * ZoteroSeek 自检：不依赖 DSH，直接对着本机的 Zotero / MinerU / 索引跑一遍体检。
 *
 *   node evals/doctor.mjs
 *
 * 输出分四段：Zotero 连通性与库规模、MinerU token 与额度台账、本地索引、以及
 * 一次「检索 → 命中长什么样」的抽样。这是排障时的第一个命令，也是评测前的环境确认。
 */
import { readFile } from 'node:fs/promises'
import { Library } from '../src/core/library.ts'
import { MineruClient } from '../src/core/mineru.ts'
import { ZoteroClient } from '../src/core/zotero.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dataDir = process.env.ZOTEROSEEK_DATA ?? join(homedir(), '.zotero-seek')

async function main() {
  console.log(`数据目录: ${dataDir}\n`)

  console.log('== Zotero ==')
  const zotero = new ZoteroClient()
  try {
    const ping = await zotero.ping()
    const page = await zotero.listItems({ limit: 100 })
    console.log(`  连通: ${ping.apiVersion}`)
    console.log(`  条目: 前 100 页取到 ${page.items.length} 篇（Total-Results=${page.total ?? '未知'}）`)
    const first = page.items[0]
    if (first !== undefined) {
      const pdf = await zotero.resolvePdf(first.key)
      console.log(`  首条: ${first.key} ${first.title.slice(0, 50)}`)
      console.log(`  PDF : ${pdf === null ? '没有可用 PDF' : pdf.path}`)
    }
  } catch (error) {
    console.log(`  ✗ ${error.message}`)
  }

  console.log('\n== MinerU ==')
  let settings = {}
  try {
    settings = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'))
  } catch {
    settings = {}
  }
  const token = (settings.mineruToken ?? process.env.MINERU_TOKEN ?? '').trim()
  const mineru = new MineruClient({ token, dataDir })
  console.log(`  token 来源: ${settings.mineruToken ? '面板设置（settings.json）' : token.length > 0 ? 'MINERU_TOKEN 环境变量' : '未配置'}`)
  if (token.length > 0) {
    const check = await mineru.checkToken()
    console.log(`  token 校验: ${check.valid ? '✓' : '✗'} ${check.message}`)
  }
  console.log(`  今日台账: ${await mineru.todayPages()} 页（MinerU 上限 2000 页/天，北京时间 00:00 重置）`)
  const parsed = await mineru.listParsed()
  console.log(`  已解析: ${parsed.length} 篇`)

  console.log('\n== 本地索引 ==')
  const library = await Library.open(dataDir)
  const stats = library.stats()
  console.log(`  条目 ${stats.items} · 已入库 ${stats.parsedItems} · 分块 ${stats.chunks} · 构建于 ${stats.builtAt ?? '（从未构建）'}`)

  const sample = library.chunksOf(library.parsedItems()[Object.keys(library.parsedItems())[0] ?? ''] ? Object.keys(library.parsedItems())[0] ?? '' : '')
  if (sample.length > 0) {
    console.log('\n== 检索抽样 ==')
    const question = '这篇文献用了什么方法？'
    const hits = library.search(question, { topK: 3 })
    hits.forEach((hit, index) => {
      console.log(`  [${index + 1}] ${hit.chunkId} · ${hit.sectionPath} · p${hit.page === null ? '?' : hit.page + 1} · score ${hit.score}`)
      console.log(`      ${hit.text.slice(0, 80).replace(/\n/g, ' ')}…`)
    })
  } else {
    console.log('\n（还没有入库的文献，先跑一次 zotero_index 或 evals/ingest.mjs）')
  }
}

await main()
