/**
 * 公式预渲染：`$$…$$` → KaTeX display，`$…$` → inline。
 * 独立成模块（不 import CSS），这样 `node --test` 可以直接测字符串变换。
 */
import katex from 'katex'
/** 把公式渲染成 HTML；失败时退化成等宽文本，不让整篇渲染崩掉。 */
export function renderMath(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html',
    })
  } catch {
    const escaped = latex.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'))
    return `<span class="zse-math-error">${escaped}</span>`
  }
}

/**
 * 预渲染公式：`$$…$$` → KaTeX display 模式，`$…$` → inline 模式。
 * 只处理成对的 $，不成对的保留原文（避免把价格、变量名误当公式）。
 */
export function preRenderMath(source: string): string {
  let text = source
  // 块公式：$$ … $$（可跨行）
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_whole, latex: string) => {
    const trimmed = latex.trim()
    if (trimmed.length === 0) return ''
    return `\n<div class="zse-math-block">${renderMath(trimmed, true)}</div>\n`
  })
  // 行内公式：$ … $（不跨行、不以空白开头结尾，避免误伤货币符号）
  text = text.replace(/(^|[^$\\])\$(?![\s$])([^\n$]{1,400}?)(?<![\s$])\$(?!\$)/g, (whole, prefix: string, latex: string) => {
    const trimmed = latex.trim()
    if (trimmed.length === 0) return whole
    return `${prefix}<span class="zse-math-inline">${renderMath(trimmed, false)}</span>`
  })
  return text
}

