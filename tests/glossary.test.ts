import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeExpansion, expandQuery, GLOSSARY_SIZE } from '../src/core/glossary.ts'

test('词表规模不为空', () => {
  assert.ok(GLOSSARY_SIZE > 50)
})

test('expandQuery: 中文技术词扩展成英文等价词', () => {
  const expansion = expandQuery('衬砌背后空洞检测')
  assert.ok(expansion.added.some((item) => item.from === '空洞' && item.to.includes('void')))
  assert.ok(expansion.added.some((item) => item.from === '衬砌' && item.to === 'lining'))
  assert.ok(expansion.added.some((item) => item.from === '检测' && item.to.includes('detection')))
  assert.equal(expansion.added.find((item) => item.to === 'void')?.direction, 'zh→en')
  assert.ok(expansion.expandedQuery.includes('void'))
  assert.ok(expansion.expandedQuery.startsWith('衬砌背后空洞检测'))
})

test('expandQuery: 英文查询扩展成中文等价词（反方向）', () => {
  const expansion = expandQuery('GPR cavity imaging')
  assert.ok(expansion.added.some((item) => item.direction === 'en→zh' && item.to === '探地雷达'))
  assert.ok(expansion.added.some((item) => item.direction === 'en→zh' && item.to === '空洞'))
})

test('expandQuery: 没有领域词时不扩展', () => {
  const expansion = expandQuery('今天天气怎么样')
  assert.equal(expansion.added.length, 0)
  assert.equal(expansion.expandedQuery, '今天天气怎么样')
  assert.equal(describeExpansion(expansion), '')
})

test('expandQuery: 追加词去重且有上限', () => {
  const expansion = expandQuery('隧道衬砌空洞检测探地雷达激光多普勒测振注浆加固裂缝变形应力位移厚度')
  const lowered = expansion.added.map((item) => item.to.toLowerCase())
  assert.equal(new Set(lowered).size, lowered.length)
  assert.ok(expansion.added.length <= 40)
})

test('describeExpansion: 给出可读解释', () => {
  const text = describeExpansion(expandQuery('空洞检测'))
  assert.ok(text.includes('跨语言扩展'))
  assert.ok(text.includes('void') || text.includes('detection'))
})
