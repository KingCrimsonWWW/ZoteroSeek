import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEval, type QaRow } from '../src/core/eval.ts'
import type { SearchHit } from '../src/core/types.ts'

function hit(chunkId: string, text = 'relevant passage'): SearchHit {
  return {
    chunkId,
    itemKey: 'K1',
    title: 'T',
    sectionPath: 'S',
    page: 0,
    kind: 'text',
    text,
    score: 1,
    route: 'lexical',
    matched: [],
    source: 'body',
    indexed: true,
  }
}

/** 最小可用的 Library 替身：只实现 runEval 用到的 search / stats。 */
function fakeLibrary(map: Record<string, string[]>) {
  return {
    search: (query: string, options: { topK?: number } = {}) => {
      const ids = map[query] ?? []
      return ids.slice(0, options.topK ?? 5).map((id) => hit(id))
    },
    stats: () => ({ items: 1, parsedItems: 1, chunks: 3, builtAt: null, dataDir: '/tmp' }),
  } as unknown as import('../src/core/library.ts').Library
}

const ROWS: QaRow[] = [
  { id: 'a', q: 'q1', gold_chunk_id: 'K1:0001', type: 'fact' },
  { id: 'b', q: 'q2', gold_chunk_id: 'K1:0002', type: 'method' },
  { id: 'c', q: 'q3', gold_chunk_id: 'K1:0003', type: 'fact' },
]

test('runEval: recall / answer_rate / citation_accuracy 计算正确', async () => {
  const library = fakeLibrary({
    q1: ['K1:0001', 'K1:0009'], // gold 第 1 位
    q2: ['K1:0009', 'K1:0008', 'K1:0002'], // gold 第 3 位
    q3: ['K1:0009'], // gold 未命中
  })
  let call = 0
  const report = await runEval({
    library,
    rows: ROWS,
    qaPath: 'memory',
    modelLabel: 'fake/model',
    deps: {
      complete: async () => {
        call += 1
        // 1: 合法引用；2: 合法引用；3: 非法引用（应触发重试，再失败则剥离）
        if (call === 1) return '结论A[^1^]'
        if (call === 2) return '结论B[^2^]'
        return '结论C[^9^]'
      },
    },
  })
  assert.equal(report.metrics.recallAtK, 0.6667)
  assert.equal(report.metrics.mrr, 0.4444)
  assert.equal(report.metrics.answerRate, 0.6667)
  // 第 3 题：raw 含 [^9^] 但被剥离，citationAccuracy 的分母只统计合法回答里的引用
  assert.ok(report.metrics.citationAccuracy !== null)
  assert.equal(report.metrics.citationAccuracy, 0.6667)
  assert.equal(report.results.length, 3)
  assert.equal(report.byType['fact']?.total, 2)
  assert.equal(report.byType['method']?.total, 1)
  assert.equal(report.failures.length, 1)
})

test('runEval: 检索全空时指标为 0 且回答是「没有相关内容」', async () => {
  const library = fakeLibrary({})
  const report = await runEval({
    library,
    rows: [ROWS[0] as QaRow],
    qaPath: 'memory',
    modelLabel: 'fake/model',
    deps: { complete: async () => '不该被调用' },
  })
  assert.equal(report.metrics.recallAtK, 0)
  assert.equal(report.metrics.hitRate, 0)
  assert.equal(report.metrics.answerRate, 0)
  assert.equal(report.metrics.citationAccuracy, null)
  assert.ok(report.results[0]?.answer.includes('文献库中没有相关内容'))
})

test('runEval: limit 只跑前 N 题', async () => {
  const library = fakeLibrary({ q1: ['K1:0001'], q2: ['K1:0002'], q3: ['K1:0003'] })
  const report = await runEval({
    library,
    rows: ROWS,
    qaPath: 'memory',
    modelLabel: 'fake/model',
    limit: 2,
    deps: { complete: async () => 'a[^1^]' },
  })
  assert.equal(report.results.length, 2)
  assert.equal(report.qaSet.questions, 2)
})

test('runEval: mode 透传到检索（记录在报告里）', async () => {
  const library = fakeLibrary({ q1: ['K1:0001'] })
  const report = await runEval({
    library,
    rows: [ROWS[0] as QaRow],
    qaPath: 'memory',
    modelLabel: 'fake/model',
    mode: 'lexical',
    deps: { complete: async () => 'a[^1^]' },
  })
  assert.equal(report.mode, 'lexical')
})
