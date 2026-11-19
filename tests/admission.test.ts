import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  admitCandidates,
  coverageDenominatorOf,
  coverageOf,
  EXPANDED_ADMISSION,
  validateAdmissionRules,
} from '../src/core/admission.ts'

const candidate = (id: string, score: number, matched: number): { id: string; score: number; matched: string[] } => ({
  id,
  score,
  matched: Array.from({ length: matched }, (_value, index) => `t${index}`),
})

test('coverageOf：命中词数 / 扩展词总数', () => {
  assert.equal(coverageOf(candidate('a', 3, 4), 4), 1)
  assert.equal(coverageOf(candidate('a', 3, 2), 8), 0.25)
  assert.equal(coverageOf(candidate('a', 3, 0), 8), 0)
})

test('coverageDenominatorOf：至少为 1，且按扩展词总数计（BM25 只回报 8 个命中词）', () => {
  assert.equal(coverageDenominatorOf(0), 1)
  assert.equal(coverageDenominatorOf(17), 17)
  assert.equal(coverageDenominatorOf(8), 8)
})

test('admitCandidates：覆盖率不足一律拦下，整路不达标时 gated=true', () => {
  const outcome = admitCandidates([candidate('a', 10, 1), candidate('b', 9, 1)], { minCoverage: 0.5, margin: 0.5 }, 4)
  assert.deepEqual(outcome.admitted, [])
  assert.equal(outcome.gated, true)
  assert.equal(outcome.rejected, 2)
})

test('admitCandidates：过了覆盖率后，按分数余量保留同组片段', () => {
  const outcome = admitCandidates(
    [candidate('high', 10, 4), candidate('near', 6, 4), candidate('far', 2, 4)],
    { minCoverage: 0.5, margin: 0.5 },
    4,
  )
  // best=10，阈值 5：high/near 保留，far 被余量拦掉
  assert.deepEqual(outcome.admitted.map((hit) => hit.id), ['high', 'near'])
  assert.equal(outcome.best, 10)
  assert.equal(outcome.threshold, 5)
  assert.equal(outcome.rejected, 0)
})

test('admitCandidates：并列分数按 id 稳定排序，空输入直接返回空', () => {
  const tie = admitCandidates([candidate('b', 5, 4), candidate('a', 5, 4)], { minCoverage: 0.5, margin: 0.5 }, 4)
  assert.deepEqual(tie.admitted.map((hit) => hit.id), ['a', 'b'])
  const empty = admitCandidates([], { minCoverage: 0.5, margin: 0.5 }, 4)
  assert.deepEqual(empty.admitted, [])
  assert.equal(empty.gated, false)
})

test('validateAdmissionRules：越界与非法值直接报错（不允许静默放行全部）', () => {
  assert.throws(() => validateAdmissionRules({ minCoverage: -0.1, margin: 0.5 }, 'test'))
  assert.throws(() => validateAdmissionRules({ minCoverage: 0.5, margin: 2 }, 'test'))
  assert.throws(() => validateAdmissionRules({ minCoverage: Number.NaN, margin: 0.5 }, 'test'))
})

test('EXPANDED_ADMISSION：生产参数来自标定，落在合法区间', () => {
  assert.ok(EXPANDED_ADMISSION.minCoverage > 0 && EXPANDED_ADMISSION.minCoverage < 1)
  assert.ok(EXPANDED_ADMISSION.margin >= 0 && EXPANDED_ADMISSION.margin <= 1)
})
