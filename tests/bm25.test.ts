import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Bm25Index, tokenize } from '../src/core/bm25.ts'

test('tokenize: 中文切二元 bigram，虚词单字丢弃', () => {
  assert.deepEqual(tokenize('隧道衬砌空洞检测'), ['隧道', '道衬', '衬砌', '砌空', '空洞', '洞检', '检测'])
  assert.deepEqual(tokenize('的'), [])
})

test('tokenize: 英文小写、去停用词、保留数字与缩写', () => {
  assert.deepEqual(tokenize('The GPR signal of 2026'), ['gpr', 'signal', '2026'])
  assert.deepEqual(tokenize('a b cd'), ['cd'])
})

test('tokenize: 中英混排与标点', () => {
  const tokens = tokenize('基于 GPR 的衬砌空洞识别（2021）')
  assert.ok(tokens.includes('gpr'))
  assert.ok(tokens.includes('空洞'))
  assert.ok(tokens.includes('2021'))
  assert.ok(!tokens.includes('（'))
})

test('bm25: 中文查询能命中相关 chunk，且命中词可解释', () => {
  const index = new Bm25Index()
  index.build([
    { id: 'a', title: '隧道衬砌背后空洞的探地雷达识别', section: '方法', text: '本文用 GPR 识别衬砌背后的空洞，空洞会导致衬砌开裂。' },
    { id: 'b', title: '铁路隧道运营期事故统计', section: '结论', text: '事故主要发生在运营期，与衬砌病害有关。' },
    { id: 'c', title: '激光多普勒测振', section: '引言', text: '使用激光多普勒测振仪检测轨道板脱空。' },
  ])
  const hits = index.search('衬砌空洞怎么识别', 3)
  assert.equal(hits[0]?.id, 'a')
  assert.ok(hits[0]?.matched.includes('空洞'))
  assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0))
})

test('bm25: 标题权重高于正文', () => {
  const index = new Bm25Index()
  index.build([
    { id: 'title-hit', title: '空洞检测', section: '', text: '本文讨论别的主题。' },
    { id: 'body-hit', title: '别的主题', section: '', text: '本文讨论空洞检测。' },
  ])
  const hits = index.search('空洞检测', 2)
  assert.equal(hits[0]?.id, 'title-hit')
})

test('bm25: 空查询/不存在词返回空', () => {
  const index = new Bm25Index()
  index.build([{ id: 'a', title: 'x', section: '', text: 'y' }])
  assert.deepEqual(index.search('', 5), [])
  assert.deepEqual(index.search('完全不存在的内容', 5), [])
})

test('bm25: 空索引不崩', () => {
  const index = new Bm25Index()
  index.build([])
  assert.equal(index.size, 0)
  assert.deepEqual(index.search('空洞', 5), [])
})
