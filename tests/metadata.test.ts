import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library, buildMetadataChunk } from '../src/core/library.ts'
import type { LibraryIndex, ZoteroItem } from '../src/core/types.ts'

function makeItem(overrides: Partial<ZoteroItem> = {}): ZoteroItem {
  return {
    key: 'META0001',
    itemType: 'journalArticle',
    title: 'Dynamic load factor of concrete defects in hammer loading',
    creators: ['Yasuda, Naotoshi'],
    year: 2023,
    date: null,
    doi: '10.1016/j.tust.2023.105309',
    citationKey: 'DynamicLoadFactor2023',
    publicationTitle: 'Tunnelling and Underground Space Technology',
    abstractNote: 'Defects behind the lining are evaluated by hammering tests.',
    extra: '关键词: 空洞; 脱空',
    tags: ['/unread', '空洞', '激光+LDV'],
    collections: [],
    pdfAttachmentKey: null,
    pdfPath: null,
    ...overrides,
  }
}

test('buildMetadataChunk: 标题/作者/标签/摘要/extra/DOI 都进检索文本', () => {
  const chunk = buildMetadataChunk(makeItem())
  assert.equal(chunk.chunkId, 'META0001:meta')
  assert.equal(chunk.source, 'meta')
  assert.equal(chunk.sectionPath, '元数据')
  assert.equal(chunk.page, null)
  for (const needle of ['Dynamic load factor', 'Yasuda', '标签：', '空洞', '摘要：', '关键词', '10.1016/j.tust.2023.105309']) {
    assert.ok(chunk.text.includes(needle), `元数据文本缺少：${needle}`)
  }
})

test('Library.open: 旧索引（无元数据块）打开后自动补齐并在标签上可检索', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zoteroseek-meta-'))
  try {
    const index: LibraryIndex = {
      version: 1,
      builtAt: '',
      settingsFingerprint: '',
      items: [makeItem()],
      parsed: {},
      chunks: [],
    }
    await writeFile(join(dir, 'index.json'), JSON.stringify(index), 'utf8')
    const library = await Library.open(dir)
    // 打开即迁移：每个条目补一个元数据块
    assert.equal(library.stats().metaChunks, 1)
    const hits = library.search('空洞', { topK: 3 })
    assert.ok(hits.length > 0, '标签「空洞」应能命中元数据块')
    assert.equal(hits[0]?.chunkId, 'META0001:meta')
    assert.equal(hits[0]?.source, 'meta')
    // 未入库条目的元数据命中必须标成 indexed=false
    assert.equal(hits[0]?.indexed, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('元数据块不进入 chunksOf（阅读视图只列正文）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zoteroseek-meta2-'))
  try {
    const index: LibraryIndex = {
      version: 1,
      builtAt: '',
      settingsFingerprint: '',
      items: [makeItem()],
      parsed: {},
      chunks: [],
    }
    await writeFile(join(dir, 'index.json'), JSON.stringify(index), 'utf8')
    const library = await Library.open(dir)
    assert.deepEqual(library.chunksOf('META0001'), [])
    assert.notEqual(library.getChunk('META0001:meta'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
