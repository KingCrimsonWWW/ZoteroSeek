import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library, normalizeVariants } from '../src/core/library.ts'
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
  extra: null,
  tags: [],
  collections: [],
  pdfAttachmentKey: null,
  pdfPath: null,
}

// 语料刻意覆盖多个领域词（void / cavity / hollow / delamination / detection / method），
// 这样扩展路的「覆盖率准入」才有可判的样本——真实论文里这些词也常一起出现。
const MARKDOWN = [
  '# 1 Introduction',
  '',
  'Void defects behind the tunnel lining threaten structural safety and require timely detection.',
  '',
  '## 2 Method',
  '',
  'Ground penetrating radar (GPR) is used to image the voids behind the reinforced concrete lining.',
  'The detection method combines back projection imaging with a sliding window inversion.',
  'Cavity and hollow defects are compared with delamination cases in the measurement campaign.',
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
    const bodyHits = hybrid.filter((hit) => hit.source === 'body')
    assert.ok(bodyHits.length > 0, '应包含正文命中')
    assert.ok(
      bodyHits.every((hit) => hit.matchKind === 'expanded' || hit.matchKind === 'mixed'),
      '正文命中应标注为扩展或两路命中',
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

test('命中类型与归一分数：matchKind 三态、scoreNorm 落在 0–1', async () => {
  const { library, dir } = await openLibrary()
  try {
    const detail = library.searchDetailed('隧道衬砌空洞的探地雷达识别', { topK: 5 })
    assert.ok(detail.hits.length > 0)
    for (const hit of detail.hits) {
      assert.ok(['literal', 'expanded', 'mixed'].includes(hit.matchKind), `非法 matchKind：${hit.matchKind}`)
      assert.ok(hit.scoreNorm >= 0 && hit.scoreNorm <= 1, `scoreNorm 越界：${hit.scoreNorm}`)
    }
    assert.ok(detail.admission !== null)
    assert.ok(detail.admission.minCoverage > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('query_variants：附加问法参与打分，且同一片段取最高分', async () => {
  const { library, dir } = await openLibrary()
  try {
    const without = library.search('空洞', { mode: 'hybrid', topK: 5 })
    const withVariants = library.search('空洞', { mode: 'hybrid', topK: 5, variants: ['void detection', 'ground penetrating radar'] })
    assert.ok(withVariants.length > 0)
    assert.ok(withVariants.length >= without.length)
    assert.ok(withVariants.some((hit) => hit.matched.some((term) => term === 'void' || term === 'radar')))
    assert.ok(withVariants.every((hit) => hit.scoreNorm >= 0 && hit.scoreNorm <= 1))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('normalizeVariants：去空白、去重、去掉主查询本身、最多 4 条', () => {
  assert.deepEqual(normalizeVariants('空洞', ['  ', '空洞', 'void', 'void', 'cavity', 'radar', 'gpr', 'extra']), ['void', 'cavity', 'radar', 'gpr'])
  assert.deepEqual(normalizeVariants('空洞', undefined), [])
})