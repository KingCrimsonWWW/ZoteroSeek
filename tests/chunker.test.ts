import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blocksFromContentList,
  blocksFromMarkdown,
  buildChunks,
  estimateTokens,
} from '../src/core/chunker.ts'

test('estimateTokens: 汉字计 1，英文按 4 字符计', () => {
  assert.equal(estimateTokens('空洞检测'), 4)
  assert.equal(estimateTokens('abcd'), 1)
})

test('blocksFromMarkdown: 标题层级 / 段落 / 表格 / 公式 / 图片 / 代码块', () => {
  const markdown = [
    '# 1 引言',
    '',
    '这是一段正文，讲述隧道衬砌空洞问题。',
    '',
    '## 1.1 背景',
    '',
    '| 方法 | 精度 |',
    '| --- | --- |',
    '| GPR | 0.9 |',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '![图 1 检测系统](images/abc.jpg)',
    '',
    '```python',
    'print("hi")',
    '```',
  ].join('\n')
  const blocks = blocksFromMarkdown(markdown)
  const kinds = blocks.map((block) => block.kind)
  assert.ok(kinds.includes('title'))
  assert.ok(kinds.includes('text'))
  assert.ok(kinds.includes('table'))
  assert.ok(kinds.includes('equation'))
  assert.ok(kinds.includes('image'))
  assert.ok(kinds.includes('code'))
  const heading = blocks.find((block) => block.kind === 'title')
  assert.equal(heading?.headingLevel, 1)
  assert.equal(heading?.text, '1 引言')
})

test('blocksFromContentList: v2 按页分组能带出页码', () => {
  const raw = [
    [{ type: 'text', text: '第一页的内容' }],
    [
      { type: 'text', text: '第二页的正文', text_level: 2 },
      { type: 'table', table_caption: ['表 1 参数'], table_body: '<table><tr><td>1</td></tr></table>' },
    ],
  ]
  const blocks = blocksFromContentList(raw)
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0]?.page, 0)
  assert.equal(blocks[1]?.page, 1)
  assert.equal(blocks[1]?.headingLevel, 2)
  assert.equal(blocks[2]?.kind, 'table')
  assert.ok(blocks[2]?.text.includes('表 1 参数'))
  assert.ok(blocks[2]?.text.includes('<table>'))
})

test('blocksFromContentList: v1 扁平块按 page_idx 取页码', () => {
  const raw = [
    { type: 'text', text: '第三页', page_idx: 2 },
    { type: 'equation', text: '$$a+b$$', page_idx: 2 },
    { type: 'image', img_path: 'images/x.jpg', image_caption: ['图 2 系统'] },
  ]
  const blocks = blocksFromContentList(raw)
  assert.equal(blocks[0]?.page, 2)
  assert.equal(blocks[1]?.kind, 'equation')
  assert.equal(blocks[2]?.imagePath, 'images/x.jpg')
  assert.equal(blocks[2]?.page, null)
})

test('buildChunks: 章节路径在 chunk 起点捕获，并跟着标题切换', () => {
  const markdown = [
    '# 3 方法',
    '',
    '## 3.2 空洞识别',
    '',
    '我们使用 GPR 数据识别衬砌背后的空洞，识别流程分为三步：预处理、特征提取、分类。',
    '预处理包括去噪与增益补偿，去噪使用带通滤波，增益补偿按深度分段计算。',
    '特征提取使用双曲特征与瞬时振幅，双曲特征用于定位空洞横向位置。',
    '分类使用阈值加人工复核，阈值由历史数据统计得到，复核由两名工程师独立完成。',
    '',
    '## 3.3 实验',
    '',
    '实验在三个隧道断面进行，采集了 120 组数据，准确率达到 92.5%。另外补充了重复实验，结果稳定。',
  ].join('\n')
  const blocks = blocksFromMarkdown(markdown)
  const chunks = buildChunks({ key: 'ABCD1234', title: '隧道衬砌空洞识别' }, blocks, {
    maxTokens: 20,
    overlapTokens: 0,
    minTokens: 5,
  })
  assert.ok(chunks.length >= 2, `期望拆成多块，实际 ${chunks.length}`)
  assert.equal(chunks[0]?.chunkId, 'ABCD1234:0000')
  assert.ok(chunks[0]?.sectionPath.includes('3 方法'), `首块章节：${chunks[0]?.sectionPath}`)
  assert.ok(chunks.some((chunk) => chunk.sectionPath.includes('3.2 空洞识别')), '后续块应进入 3.2 空洞识别')
  assert.ok(chunks.some((chunk) => chunk.sectionPath.includes('3.3 实验')), '应出现 3.3 实验 章节')
  assert.ok(chunks.every((chunk) => chunk.itemKey === 'ABCD1234'))
  assert.ok(chunks.every((chunk) => chunk.title === '隧道衬砌空洞识别'))
})

test('buildChunks: 表格不跨越 chunk 边界', () => {
  const table = `<table><tr><td>${'数据'.repeat(300)}</td></tr></table>`
  const blocks = blocksFromContentList([
    [{ type: 'text', text: '前面的正文'.repeat(50) }, { type: 'table', table_body: table }],
  ])
  const chunks = buildChunks({ key: 'K1', title: 'T' }, blocks, { maxTokens: 200, overlapTokens: 20 })
  const tableChunks = chunks.filter((chunk) => chunk.text.includes('<table>'))
  assert.equal(tableChunks.length, 1)
  assert.equal(tableChunks[0]?.kind, 'table')
  assert.ok(tableChunks[0]?.text.includes(table))
})

test('buildChunks: 低于最小长度的碎片被丢弃', () => {
  const blocks = blocksFromMarkdown('# 标题\n\n短。\n')
  const chunks = buildChunks({ key: 'K', title: 'T' }, blocks, { minTokens: 40 })
  assert.equal(chunks.length, 0)
})

test('buildChunks: 空输入返回空数组', () => {
  assert.deepEqual(buildChunks({ key: 'K', title: 'T' }, []), [])
})
