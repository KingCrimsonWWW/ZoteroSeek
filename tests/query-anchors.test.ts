import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractAnchors, hasStrongAnchor } from '../src/core/query-anchors.ts'

test('提取缩写/型号/驼峰命名', () => {
  const anchors = extractAnchors('What accuracy did the variable-frame-length MFCC reach, compared with AcrcNet?')
  assert.ok(anchors.some((anchor) => anchor.text === 'MFCC'))
  assert.ok(anchors.some((anchor) => anchor.text === 'AcrcNet'))
})

test('表图编号会做中英互换', () => {
  const zh = extractAnchors('表 5-4 在比较单尺度与多尺度动态卷积时显示了什么？')
  assert.ok(zh.some((anchor) => anchor.text === 'Table 5-4'))
  assert.ok(zh.some((anchor) => anchor.text === '表 5-4'))
  const en = extractAnchors('What does Table 5-4 show?')
  assert.ok(en.some((anchor) => anchor.text === '表 5-4'))
})

test('带单位的数值进入锚点，但纯数值不算强锚点', () => {
  const anchors = extractAnchors('For a void of 300 mm diameter and 20 mm depth, what frequency was found?')
  assert.ok(anchors.some((anchor) => anchor.kind === 'number'))
  assert.equal(hasStrongAnchor(anchors), false)
})

test('句首大写词不会被误当缩写', () => {
  const anchors = extractAnchors('For how long does the signal decay?')
  assert.ok(!anchors.some((anchor) => ['For', 'How'].includes(anchor.text)))
})
