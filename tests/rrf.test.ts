import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuseRrf } from '../src/core/rrf.ts'

test('fuseRrf: 两路都靠前的结果排在只在一路靠前的结果前面', () => {
  const fused = fuseRrf([
    { ids: ['a', 'b', 'c'] },
    { ids: ['b', 'a', 'd'] },
  ])
  assert.deepEqual(fused.slice(0, 2).map((hit) => hit.id).sort(), ['a', 'b'])
  assert.equal(fused[0]?.id === 'a' || fused[0]?.id === 'b', true)
})

test('fuseRrf: 只有一路命中时按该路名次排序', () => {
  const fused = fuseRrf([{ ids: ['x', 'y', 'z'] }, { ids: [] }])
  assert.deepEqual(fused.map((hit) => hit.id), ['x', 'y', 'z'])
})

test('fuseRrf: 权重影响融合顺序', () => {
  const lexicalFirst = fuseRrf([
    { ids: ['a'], weight: 1 },
    { ids: ['b'], weight: 0.1 },
  ])
  assert.equal(lexicalFirst[0]?.id, 'a')
  const expandedFirst = fuseRrf([
    { ids: ['a'], weight: 0.1 },
    { ids: ['b'], weight: 1 },
  ])
  assert.equal(expandedFirst[0]?.id, 'b')
})

test('fuseRrf: topK 截断与空输入', () => {
  const fused = fuseRrf([{ ids: ['a', 'b', 'c'] }], { topK: 2 })
  assert.equal(fused.length, 2)
  assert.deepEqual(fuseRrf([]), [])
  assert.deepEqual(fuseRrf([{ ids: [] }]), [])
})

test('fuseRrf: 记录每路名次，便于解释', () => {
  const fused = fuseRrf([{ ids: ['a', 'b'] }, { ids: ['b'] }])
  const b = fused.find((hit) => hit.id === 'b')
  assert.equal(b?.ranks.length, 2)
  assert.deepEqual(b?.ranks.map((rank) => rank.rank).sort(), [1, 2])
})
