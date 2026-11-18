import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerGrounded, parseCitations, stripInvalidCitations, verifyCitations } from '../src/core/grounding.ts'
import type { SearchHit } from '../src/core/types.ts'

function hit(chunkId: string, text: string): SearchHit {
  return { chunkId, itemKey: 'K1', title: '隧道衬砌空洞识别', sectionPath: '3 方法', page: 2, kind: 'text', text, score: 1, route: 'lexical', matched: [] }
}

test('parseCitations: 只认 [^N^]，普通方括号不算引用', () => {
  assert.deepEqual(parseCitations('结论[^1^]，另有依据[^2^][^1^]，参考文献 [3] 不算'), [1, 2])
  assert.deepEqual(parseCitations('没有引用'), [])
})

test('verifyCitations: 越界编号被判非法', () => {
  const ok = verifyCitations('a[^1^]b[^3^]', 3)
  assert.equal(ok.ok, true)
  const bad = verifyCitations('a[^1^]b[^9^]', 3)
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.invalid, [9])
})

test('stripInvalidCitations: 只删非法标记，保留合法标记与正文', () => {
  assert.equal(stripInvalidCitations('甲[^1^]乙[^9^]丙', 3), '甲[^1^]乙丙')
})

test('answerGrounded: 合法引用直接通过', async () => {
  const result = await answerGrounded('怎么识别空洞？', {
    search: () => [hit('K1:0001', '用 GPR 识别衬砌背后空洞。'), hit('K1:0002', '准确率 92.5%。')],
    complete: async () => '结论：用 GPR 识别[^1^]，准确率 92.5%[^2^]。',
  })
  assert.equal(result.retried, false)
  assert.equal(result.citationsStripped, false)
  assert.deepEqual(result.citations, [1, 2])
})

test('answerGrounded: 非法引用触发一次纠正重试', async () => {
  let calls = 0
  const result = await answerGrounded('怎么识别空洞？', {
    search: () => [hit('K1:0001', '用 GPR 识别衬砌背后空洞。')],
    complete: async ({ user }) => {
      calls += 1
      if (calls === 1) return '瞎编[^7^]'
      assert.ok(user.includes('纠正'), '第二次调用要带纠正提示')
      return '用 GPR 识别[^1^]'
    },
  })
  assert.equal(result.retried, true)
  assert.equal(result.citationsStripped, false)
  assert.deepEqual(result.citations, [1])
})

test('answerGrounded: 重试后仍非法则剥离标记并标注', async () => {
  const result = await answerGrounded('怎么识别空洞？', {
    search: () => [hit('K1:0001', '用 GPR 识别衬砌背后空洞。')],
    complete: async () => '一直瞎编[^7^]',
  })
  assert.equal(result.retried, true)
  assert.equal(result.citationsStripped, true)
  assert.equal(result.answer.includes('[^7^]'), false)
})

test('answerGrounded: 检索为空时明确说没有，不调用模型', async () => {
  let called = false
  const result = await answerGrounded('宇宙起源是什么？', {
    search: () => [],
    complete: async () => {
      called = true
      return '不该被调用'
    },
  })
  assert.equal(called, false)
  assert.ok(result.answer.includes('文献库中没有相关内容'))
  assert.deepEqual(result.citations, [])
})
