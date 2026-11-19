/**
 * 面板 UI 冒烟测试：不启动浏览器，直接把打包后的 Client bundle 装进一个假模块表，
 * 用 react-dom/server 渲染出静态 DOM，检查结构、可访问性与「页签样式」这类回归。
 *
 * 这是对「我自己没法点页面」的补偿：凡是能由 DOM 验证的（页签角色、空状态按钮、
 * aria-label、面板级 CSS），都在这里断言；只有像素级观感仍需要人看截图。
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const React = require('react') as typeof import('react')

interface CapturedModule {
  id: string
  factory: (req: (name: string) => unknown) => { inject?: string[]; apply: (ctx: unknown) => void }
}

let markup = ''

before(async () => {
  const code = await readFile(new URL('../plugin/client.js', import.meta.url), 'utf8')
  let captured: CapturedModule | null = null
  const fakeWindow = {
    __ModuleLoader__: {
      load: (module: CapturedModule) => { captured = module },
    },
  }
  // bundle 顶层只做「注册模块」，不碰 DOM；用 Function 注入 window 即可执行。
  // eslint-disable-next-line no-new-func
  new Function('window', code)(fakeWindow)
  if (captured === null) throw new Error('client bundle 没有注册模块')
  const registered = captured as CapturedModule

  const plugin = registered.factory((name: string) => {
    if (name === 'react') return React
    throw new Error(`测试环境未映射的模块：${name}`)
  })
  assert.equal(typeof plugin.apply, 'function')

  const slots: Array<{ name: string; component: unknown }> = []
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: { register: () => () => {} },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: () => {} },
    slots: {
      inject: (_name: string, fn: () => unknown) => fn(),
      register: (definition: { name: string }, component: unknown) => {
        slots.push({ name: definition.name, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  const panelSlot = slots.find((slot) => slot.name === 'sidebar.right.pane.tab')
  assert.ok(panelSlot !== undefined, '没有注册 sidebar.right.pane.tab')
  const Panel = panelSlot.component as (props: Record<string, unknown>) => unknown
  markup = renderToStaticMarkup(React.createElement(Panel as never, { inputActions: undefined }))
})

test('页签：三个 role=tab，只有当前页签 aria-selected=true', () => {
  const tabs = markup.match(/<div[^>]*role="tab"/g) ?? []
  assert.equal(tabs.length, 3, `应渲染 3 个页签，实际 ${tabs.length}`)
  const selected = markup.match(/<div[^>]*aria-selected="true"/g) ?? []
  assert.equal(selected.length, 1, '同时只能有一个页签被选中')
})

test('页签样式不再依赖按钮默认外观（白框问题的回归测试）', () => {
  const tabTags = markup.match(/<div[^>]*role="tab"[^>]*>/g) ?? []
  assert.equal(tabTags.length, 3)
  for (const tag of tabTags) {
    assert.ok(/border:none|border: none/.test(tag), `页签仍然带 border：${tag.slice(0, 160)}`)
    assert.ok(/outline:none|outline: none/.test(tag), `页签仍然带 outline：${tag.slice(0, 160)}`)
  }
})

test('图标按钮有无障碍名称', () => {
  assert.match(markup, /aria-label="设置"/)
  assert.match(markup, /aria-label="刷新"/)
})

test('空状态只给一个明确的下一步动作', () => {
  assert.match(markup, /没有条目/)
  assert.match(markup, />刷新</, '文献空状态应提供「刷新」按钮')
})

test('面板级 CSS：键盘焦点、选区、减少动效', () => {
  assert.match(markup, /\.zse-panel button:focus-visible/)
  assert.match(markup, /::selection/)
  assert.match(markup, /prefers-reduced-motion/)
})
