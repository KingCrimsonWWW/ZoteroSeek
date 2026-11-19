/**
 * Markdown 渲染：markdown-it + KaTeX。
 *
 * 取代早期手写的那套解析器（那套只覆盖标题/段落/表格/简单公式，公式只能原样输出 LaTeX，
 * 读起来很糟）。现在的分工：
 * - markdown-it 负责块级结构（标题、列表、表格、代码、链接、图片、引用）与 MinerU 输出的
 *   原始 HTML（表格是 `<table>` 块）；
 * - KaTeX 负责公式：先把 `$$…$$` / `$…$` 预渲染成 KaTeX 的 HTML，再交给 markdown-it，
 *   这样公式块不会被当成段落切碎；
 * - 图片路径统一改写到本插件的 `/zotero-seek/file` 路由（MinerU 产物不在包里，也不该进包）。
 *
 * KaTeX 的 CSS 用 esbuild 的 text loader 内联成字符串，注入为组件内的 `<style>`；
 * 字体文件不进包（否则再加 1 MB），缺失时自动回落到系统数学字体。
 */
import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { preRenderMath } from './math-render.ts'
// 打包时由 esbuild 的 text loader 变成字符串
import katexCssRaw from 'katex/dist/katex.min.css'

export interface MarkdownRendererOptions {
  imageUrl: (src: string) => string
}

/** KaTeX 样式：去掉 @font-face（字体文件不在包里），其余原样保留。 */
export const KATEX_CSS = katexCssRaw.replace(/@font-face\s*\{[^}]*\}/g, '')

/** 阅读区自己的样式（替代原来的 React 内联样式，因为正文现在是 innerHTML）。 */
export const MARKDOWN_CSS = `
.zse-md { font-size: 12.5px; line-height: 1.75; color: var(--dsw-alias-label-primary); word-break: break-word; }
.zse-md h1, .zse-md h2, .zse-md h3, .zse-md h4, .zse-md h5, .zse-md h6 {
  margin: 14px 0 6px; line-height: 1.4; font-weight: 650; color: var(--dsw-alias-label-primary);
}
.zse-md h1 { font-size: 15.5px; }
.zse-md h2 { font-size: 14.5px; }
.zse-md h3 { font-size: 13.5px; }
.zse-md h4, .zse-md h5, .zse-md h6 { font-size: 12.5px; }
.zse-md p { margin: 0 0 8px; }
.zse-md ul, .zse-md ol { margin: 0 0 8px; padding-left: 20px; }
.zse-md li { margin: 2px 0; }
.zse-md blockquote {
  margin: 0 0 8px; padding-left: 10px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.zse-md hr { border: none; border-top: 1px solid var(--dsw-alias-border-l1); margin: 12px 0; }
.zse-md pre {
  margin: 0 0 8px; padding: 8px; border-radius: 6px; overflow-x: auto;
  background: var(--dsw-alias-bg-layer-2); font-size: 11.5px;
}
.zse-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.zse-md p code, .zse-md li code {
  background: var(--dsw-alias-bg-layer-2); border-radius: 4px; padding: 0 3px;
}
.zse-md table {
  border-collapse: collapse; width: 100%; margin: 0 0 10px; font-size: 11.5px; display: block; overflow-x: auto;
}
.zse-md th, .zse-md td {
  border: 1px solid var(--dsw-alias-border-l1); padding: 4px 6px; text-align: left; vertical-align: top;
}
.zse-md th { background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
.zse-md img { max-width: 100%; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); display: block; margin: 6px 0; }
.zse-md a { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.zse-md a:hover { text-decoration: underline; }
.zse-math-block {
  margin: 6px 0 10px; padding: 8px 10px; border-radius: 8px; overflow-x: auto;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
}
.zse-math-inline { display: inline-block; vertical-align: baseline; }
.zse-math-error {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  color: var(--dsw-alias-label-secondary); white-space: pre-wrap;
}
`

/** 去掉可执行内容：脚本、iframe、内联事件属性。 */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

/** 创建渲染器；同一个面板里复用同一个实例（markdown-it 实例可复用）。 */
export function createMarkdownRenderer(options: MarkdownRendererOptions): (markdown: string) => string {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false })
  const defaultImage = md.renderer.rules.image
  md.renderer.rules.image = (tokens, idx, renderOptions, env, self) => {
    const token = tokens[idx]
    const attr = token?.attrGet('src')
    const raw = typeof attr === 'string' ? attr : attr === null || attr === undefined ? '' : String(attr)
    if (raw.length === 0) return ''
    const alt = self.renderInlineAsText(token?.children ?? [], renderOptions, env)
    const source = /^(https?:)?\/\//.test(raw) ? raw : options.imageUrl(raw)
    return `<img src="${escapeAttr(source)}" alt="${escapeAttr(alt)}" loading="lazy" draggable="false" />`
  }
  void defaultImage
  const defaultLinkOpen = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, idx, renderOptions, env, self) => {
    const token = tokens[idx]
    token?.attrSet('target', '_blank')
    token?.attrSet('rel', 'noreferrer noopener')
    return defaultLinkOpen === undefined
      ? self.renderToken(tokens, idx, renderOptions)
      : defaultLinkOpen(tokens, idx, renderOptions, env, self)
  }

  return (markdown: string): string => {
    const html = md.render(preRenderMath(markdown.replace(/\r\n/g, '\n')))
    return sanitize(html)
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
