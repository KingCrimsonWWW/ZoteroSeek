import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isZoteroKey, zoteroUriOf } from '../src/host/zotero-uri.ts'

test('默认只选中条目，不打开 PDF', () => {
  assert.equal(zoteroUriOf('EVRF6GD8', '556TE7EV'), 'zotero://select/library/items/EVRF6GD8')
  assert.equal(zoteroUriOf('EVRF6GD8', '556TE7EV', 7), 'zotero://select/library/items/EVRF6GD8')
  assert.equal(zoteroUriOf('EVRF6GD8', null), 'zotero://select/library/items/EVRF6GD8')
})

test('显式 mode=pdf 且有附件时打开 PDF 并带页码', () => {
  assert.equal(
    zoteroUriOf('EVRF6GD8', '556TE7EV', 7, 'pdf'),
    'zotero://open-pdf/library/items/556TE7EV?page=7',
  )
  assert.equal(
    zoteroUriOf('EVRF6GD8', '556TE7EV', null, 'pdf'),
    'zotero://open-pdf/library/items/556TE7EV',
  )
})

test('mode=pdf 但没有有效附件时退回选中条目', () => {
  assert.equal(zoteroUriOf('EVRF6GD8', null, 3, 'pdf'), 'zotero://select/library/items/EVRF6GD8')
  assert.equal(zoteroUriOf('EVRF6GD8', '', 3, 'pdf'), 'zotero://select/library/items/EVRF6GD8')
  assert.equal(zoteroUriOf('EVRF6GD8', '../evil', 3, 'pdf'), 'zotero://select/library/items/EVRF6GD8')
})

test('页码越界/非整数时忽略，不拼出坏链接', () => {
  assert.equal(zoteroUriOf('EVRF6GD8', '556TE7EV', 0, 'pdf'), 'zotero://open-pdf/library/items/556TE7EV')
  assert.equal(zoteroUriOf('EVRF6GD8', '556TE7EV', 10000, 'pdf'), 'zotero://open-pdf/library/items/556TE7EV')
  assert.equal(zoteroUriOf('EVRF6GD8', '556TE7EV', 2.5, 'pdf'), 'zotero://open-pdf/library/items/556TE7EV')
})

test('非法 item_key 直接抛错（Host 会把它变成 400）', () => {
  assert.throws(() => zoteroUriOf('../evil', null))
  assert.throws(() => zoteroUriOf('', null))
  assert.equal(isZoteroKey('EVRF6GD8'), true)
  assert.equal(isZoteroKey('bad key'), false)
})
