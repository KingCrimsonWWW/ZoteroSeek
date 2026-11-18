/**
 * 命令行入库：把若干 Zotero 条目用 MinerU 解析成 Markdown 并写进本地索引。
 *
 *   node evals/ingest.mjs <item_key> [<item_key> ...]
 *
 * 和面板里的「入库」按钮走同一条链路（Library.ingest → MineruClient.parse），
 * 只是入口不同。开发/评测时用它批量喂数据，避免手点。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../src/core/library.ts'
import { MineruClient } from '../src/core/mineru.ts'
import { ZoteroClient } from '../src/core/zotero.ts'

const dataDir = process.env.ZOTEROSEEK_DATA ?? join(homedir(), '.zotero-seek')
const keys = process.argv.slice(2).filter((value) => !value.startsWith('-'))

if (keys.length === 0) {
  console.error('用法：node evals/ingest.mjs <item_key> [<item_key> ...]')
  process.exitCode = 1
} else {
  let settings = {}
  try {
    settings = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'))
  } catch {
    settings = {}
  }
  const token = (settings.mineruToken ?? process.env.MINERU_TOKEN ?? '').trim()
  if (token.length === 0) {
    console.error('没有 MinerU token：写到 ~/.zotero-seek/settings.json 的 mineruToken，或设 MINERU_TOKEN。')
    process.exitCode = 1
  } else {
    const library = await Library.open(dataDir)
    const zotero = new ZoteroClient({
      ...(settings.zoteroBaseUrl === undefined ? {} : { baseUrl: settings.zoteroBaseUrl }),
      ...(settings.zoteroStorageDir === undefined ? {} : { storageDir: settings.zoteroStorageDir }),
    })
    const mineru = new MineruClient({ token, dataDir, language: 'ch' })

    if (library.items().length === 0) {
      const refreshed = await library.refreshItems(zotero, { maxItems: 300 })
      console.log(`[ingest] 已从 Zotero 刷新 ${refreshed.items} 条元数据`)
    }

    for (const key of keys) {
      const startedAt = Date.now()
      try {
        const result = await library.ingest(zotero, mineru, key)
        console.log(`[ingest] ✓ ${key} 《${result.item.title.slice(0, 40)}》 ${result.chunks} 块 · ${result.source}${result.cached ? ' · 缓存命中' : ''} · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
      } catch (error) {
        console.error(`[ingest] ✗ ${key}：${error.message}`)
        process.exitCode = 1
      }
    }
    console.log(`[ingest] 索引：${JSON.stringify(library.stats())}`)
  }
}
