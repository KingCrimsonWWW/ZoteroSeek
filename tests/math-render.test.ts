import { test } from 'node:test'
import assert from 'node:assert/strict'
import { preRenderMath, renderMath } from '../src/client/math-render.ts'

test('块公式：$$…$$ 渲染成 KaTeX display 块，原文不再残留 $$', () => {
  const html = preRenderMath('前文\n\n$$\n\\frac{\\partial^{4} w}{\\partial x^{4}} = q\n$$\n\n后文')
  assert.ok(html.includes('zse-math-block'), '应生成公式块容器')
  assert.ok(html.includes('katex'), '应包含 KaTeX 生成的标记')
  assert.ok(!html.includes('$$'), '不应残留 $$ 分隔符')
})

test('行内公式：$…$ 渲染成内联 KaTeX', () => {
  const html = preRenderMath('振动速度 $v = \\omega A$ 与频率相关')
  assert.ok(html.includes('zse-math-inline'), '应生成行内公式容器')
  assert.ok(!html.includes('$v'), '不应残留原始 $v')
})

test('货币/落单 $ 不被当成公式（避免把「$5」渲染成数学）', () => {
  const html = preRenderMath('价格 $5 和 $10 都不是公式')
  assert.ok(!html.includes('zse-math-inline'), '不应误判为公式')
  assert.ok(html.includes('$5'))
})

test('公式 Tag：\\tag{4} 能渲染（KaTeX 支持编号）', () => {
  const html = preRenderMath('$$a + b \\tag{4}$$')
  assert.ok(html.includes('zse-math-block'))
  // KaTeX 把编号渲染成 katex-tag 里的三个 span（'(' '4' ')'），不是连续字符串\n  assert.ok(html.includes('katex-tag'), '应渲染出公式编号标签')
})

test('坏公式不抛异常（throwOnError 关闭）', () => {
  assert.doesNotThrow(() => preRenderMath('$$\\frac{a}{$$'))
  const html = renderMath('\\frac{a}{', true)
  assert.equal(typeof html, 'string')
  assert.ok(html.length > 0)
})

test('空公式被忽略', () => {
  const html = preRenderMath('$$$$')
  assert.ok(!html.includes('zse-math-block'))
})
