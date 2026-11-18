import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../src/core/library.ts'
import { blocksFromMarkdown, buildChunks } from '../src/core/chunker.ts'
import type { LibraryIndex, ZoteroItem } from '../src/core/types.ts'

const ITEM: ZoteroItem = {
  key: 'ABCD1234',
  itemType: 'journalArticle',
  title: 'Void detection in tunnel lining using ground penetrating radar',
  creators: ['Liang, Shichuan'],
  year: 2026,
  date: null,
  doi: null,
  citationKey: null,
  publicationTitle: 'Measurement',
  abstractNote: null,
  tags: [],
  collections: [],
  pdfAttachmentKey: null,
  pdfPath: null,
}

const MARKDOWN = [
  '# 1 Introduction',
  '',
  'Void defects behind the tunnel lining threaten structural safety and require timely detection.',
  '',
  '## 2 Method',
  '',
  'Ground penetrating radar (GPR) is used to image the voids behind the reinforced concrete lining.',
  'The detection method combines back projection imaging with a sliding window inversion.',
  '',
  '## 3 Results',
  '',
  'Field experiments show that the proposed method detects voids of 0.2 m to 0.5 m behind the lining.',
].join('\n')

async function openLibrary(): Promise<{ library: Library; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'zoteroseek-hybrid-'))
  const chunks = buildChunks({ key: ITEM.key, title: ITEM.title }, blocksFromMarkdown(MARKDOWN), {
    maxTokens: 40,
    overlapTokens: 0,
    minTokens: 5,
  })
  const index: LibraryIndex = {
    version: 1,
    builtAt: new Date().toISOString(),
    settingsFingerprint: '',
    items: [ITEM],
    parsed: {},
    chunks,
  }
  await writeFile(join(dir, 'index.json'), JSON.stringify(index), 'utf8')
  return { library: await Library.open(dir), dir }
}

test('hybrid 检索：中文问题能命中英文文献，纯词面检索命中不了', async () => {
  const { library, dir } = await openLibrary()
  try {
    const lexical = library.search('空洞检测方法', { mode: 'lexical', topK: 5 })
    const hybrid = library.search('空洞检测方法', { mode: 'hybrid', topK: 5 })
    assert.equal(lexical.length, 0, '纯词面：中文 token 与英文正文无交集')
    assert.ok(hybrid.length > 0, '混合模式应通过词表扩展命中')
    assert.ok(
      hybrid.every((hit) => hit.route === 'expanded' || hit.route === 'both'),
      '命中应标注为扩展或两路命中',
    )
    assert.ok(hybrid.some((hit) => hit.matched.some((term) => term === 'void' || term === 'detection')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('hybrid 检索：searchDetailed 返回扩展解释', async () => {
  const { library, dir } = await openLibrary()
  try {
    const detail = library.searchDetailed('隧道衬砌空洞的探地雷达识别', { topK: 3 })
    assert.equal(detail.mode, 'hybrid')
    assert.ok(detail.expansion !== null)
    assert.ok((detail.expansion?.added.length ?? 0) > 0)
    assert.ok(detail.hits.length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('hybrid 检索：单篇内过滤仍然生效', async () => {
  const { library, dir } = await openLibrary()
  try {
    const inside = library.search('空洞 detection', { mode: 'hybrid', itemKey: 'ABCD1234', topK: 3 })
    const outside = library.search('空洞 detection', { mode: 'hybrid', itemKey: 'ZZZZZZZZ', topK: 3 })
    assert.ok(inside.length > 0)
    assert.equal(outside.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('词面模式下英文查询依然正常', async () => {
  const { library, dir } = await openLibrary()
  try {
    const hits = library.search('ground penetrating radar void', { mode: 'lexical', topK: 3 })
    assert.ok(hits.length > 0)
    assert.ok(hits.every((hit) => hit.route === 'lexical'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
