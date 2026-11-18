---
type: 调研
tags: [ZoteroSeek, DSH, 客户端插件, 施工说明]
创建日期: 2026-11-18
主题: DSH Client（浏览器）插件 API 施工说明
---

# 0. 本文范围与来源记号

本文只回答"怎么施工"，不写产品代码、不改 profile。所有结论标注来源；无法验证的写「未验证」。

来源记号（绝对路径前缀，后文用 `⟨A⟩`/`⟨D⟩`/`⟨SK⟩` 代替）：

- `⟨A⟩` = `D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai`
- `⟨D⟩` = `⟨A⟩\dsh\docs`（已安装版本的官方文档，`D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\docs`）
- `⟨SK⟩` = `⟨A⟩\dsh-agent-preset\skills\dsh-doc`（dsh-doc skill 的 references/templates）
- `⟨Z⟩` = GitHub `https://github.com/Vncntvx/dsh-zotero`（MIT，只借设计，不抄代码）

运行环境实测：`DSH_PROFILE=desktop`，`DSH_INSTALL_DIR=D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh`，CLI 包版本 `0.2.2-rc.3`（`⟨A⟩\dsh\package.json`）。

> 注意版本差：dsh-zotero 的 `engines.dsh` 是 `>=0.2.2-rc.4`，本机是 `rc.3`。它的 `docs/cookbook/adding-a-remote-api.md` 在本机**不存在**（`⟨D⟩\cookbook` 只有 adding-a-package / adding-a-settings-card / adding-a-tool / adding-an-llm-adapter / extension-cookbook），所以 Remote 以本机 `⟨D⟩\subsystems\typert.md` + `api-gateway.md` 为准。

---

# 1. Client 模块的产物格式

## 1.1 `window.__ModuleLoader__.load` 的确切约定

```ts
// ⟨A⟩\dsh-client-modules\src\client\manifest.ts:349-374
interface ClientBundleRequire {
  (specifier: string): unknown                 // 同步，查模块表
  async(specifier: string): Promise<unknown>   // 包内 chunk
  asset(reference: string): string             // plugins/<pkg>/assets/... → URL
}
interface ClientBundleRegistration {
  id: string                                   // = 包名 = Loader entry name
  chunk?: string                               // 仅包内 chunk 用
  factory: (require: ClientBundleRequire) => Record<string, unknown>
}
```

- 脚本执行时**只注册工厂**，模块副作用（含 CSS 注入）在 materialize（`factory(require)`）时才跑，exports 被 `loadCache` 记忆（`⟨A⟩\dsh-client-modules\README.md:77`「Lazy-CJS model」）。
- `id` 与 boot graph 行一致（即 `package.json` 的 `name`），重复注册会抛（`⟨A⟩\dsh-client-modules\src\client\system.ts:165-180`）。
- 工厂返回的 exports 就是 Cordis 插件本体：`{ inject: string[], apply(ctx) {...} }`（模板 `⟨SK⟩\templates\decoration\client.js:13-20`；dsh-zotero 校验 `typeof exported.apply === 'function' && Array.isArray(exported.inject)`，见 ⟨Z⟩`scripts/build-client.mjs` 的 `verifyBundle`）。

## 1.2 `require` 能解析什么（实测表）

平台种子表 = shell 传给模块系统的 `staticModules`（`⟨A⟩\dsh-client-modules\src\client\system.ts:136`）。本机构建产物里那张表是：

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, zod, @tanstack/react-virtual,
@deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
```

来源：`D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-web-frontend\dist\assets\index-Ciz7DZxv.js`（压缩产物；`function qJ(){return{...}}` 位于字符偏移 ~1060895，可用 `ctx.ps1 -Needle "function qJ("` 复核）。对上游源码的指认：⟨Z⟩`scripts/client-graph-authority.mjs` 注释写明这张表在 `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`。

结论：
- **能** require：`react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`zod`、`@deepseek-ai/cordis`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-dockkit`、`@deepseek-ai/dsh-client-ui-primitives`。
- **不能** require：`react/jsx-dev-runtime`、`react-dom/server`、任何 markdown 库、任何 `@deepseek-ai/dsh-client-ui-*` 功能包（除 primitives/dockkit/slots/store 这几张表里的）。
- 表外一律抛 `require("...") missed the module table`（`⟨A⟩\dsh-client-modules\src\client\system.ts:326-340`）。
- **`ui-primitives` 虽在表里，但官方规则禁止用**：`⟨SK⟩\references\practices.md:35`「Do not `require('@deepseek-ai/dsh-client-ui-primitives')` or load any other Harness Client package as a module」，理由是它们随时变、且抛错会让你的 slot entry 整块空白。注意它**没有作为独立 npm 包安装**（`⟨A⟩\dsh-client-ui-primitives` 不存在），连 `.d.ts` 都拿不到。

## 1.3 `package.json` 声明与 `dsh.client.external`

```jsonc
// 照抄 ⟨SK⟩\templates\decoration\package.json:13-20
"exports": { ".": "./index.js", "./client": "./client.js", "./locale/*.json": "./locale/*.json" },
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
}
```

- `platform` 必填且必须是字符串（`⟨A⟩\dsh-client-modules\src\client\manifest.ts:179-191`）；`immediately` 布尔（stage-one 预取）；`inject` 只用于**排序/激活**，不是模块解析；`external` 只登记**非基线**模块请求（`⟨A⟩\dsh-client-modules\README.md:34,55`）。
- **React 家族不需要 `external`**：它们已在基线表里，写了也不会变。实证：dsh-zotero 的 `dsh.client` 只有 `inject` + `platform`，没有 `external`（⟨Z⟩`package.json`）。
- `external` 的真实用途：你要用另一个**插件包**的 client 导出时才写它的包名（循环/缺失会被 composition 拒绝，同上 README:55）。

## 1.4 用 esbuild 打 TSX → 这个格式（可直接抄）

```js
// 精简自 ⟨Z⟩scripts/build-client.mjs（MIT，仅取配置思路）
import * as esbuild from 'esbuild'
const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'zod',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives', '@tanstack/react-virtual',
]
await esbuild.build({
  entryPoints: ['src/client/index.ts'], outfile: 'lib/client.js',
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  jsx: 'automatic', minify: true, sourcemap: true, external: EXTERNALS,
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({ id: "dsh-zotero-seek", factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: `return module.exports; } });` },
})
```

三条硬约束（照抄时别改）：
1. `format:'cjs'` + banner/footer 自建 `module/exports`，否则 esbuild 的 CJS 输出会在 `factory` 之外赋值。
2. `jsx:'automatic'`：`react/jsx-runtime` 在表里，JSX 不进包。
3. 产物必须是**经典 script**可执行（loader 用 `<script src>` 加载，`⟨A⟩\dsh-client-modules\src\client\system.ts:16-29`）。验证手段：用 JSDOM 设一个 `window.__ModuleLoader__ = { load: v => handoff = v }`，`vm.runInNewContext` 执行后用 `handoff.factory(spec => table[spec])` 跑一遍（⟨Z⟩`verifyBundle` 同法）。

---

# 2. `ctx.slots.inject` / `ctx.slots.register` 语义

## 2.1 inject：按"声明寿命"重跑

`ctx.slots.inject(ownerKey, callback)`：**owner 的 slot 声明每次存活就调用一次 callback**，callback 里注册的东西在 owner 收起时被递归 dispose，owner 再次挂载时 callback 再跑一次（`⟨D⟩\subsystems\slots.md:27`；`⟨SK⟩\references\practices.md:36`）。callback 可返回 disposer、或 Generator 连续 yield 多个 disposer（`⟨A⟩\dsh-client-ui-sidebar-right\src\client\index.ts:233-264` 用 `function* (){ yield ...; yield ... }`）。

对我们直接相关：右侧栏折叠/切换会话会收起 `rightbar.session` 声明，所以**注册在 `sidebar.right.pane.tab` 里的组件与 inject 工厂会被销毁重建**——面板内部状态要放 store 或模块级单例，不能指望组件实例活着。

## 2.2 register：options 逐字段

实现层的完整字段（`⟨A⟩\dsh-client-ui-renderer\src\client\registry.ts:84-100`，`ErasedRegisterOptions`）：

| 字段 | 作用 | 备注 |
|---|---|---|
| `name` | **必填**，目标 slot key | 必须在 `SlotMap` 里被 owner 声明过，否则激活期抛（slots.md:23） |
| `key` | keyed slot 的 dispatch key | `sidebar.right.pane.tab` / `main` / `sidebar.panel.icon` 用 |
| `id` | list slot 的行 id，必填 | `sidebar.panellist` / `shell.overlay` 用 |
| `order` | list 排序（小在前），同 order 按注册顺序 | slots.md:61 |
| `priority` | single/list/keyed/hoc 的**遮蔽**rank（小者先/胜） | 不是排序，是替换优先级（slots.md:69） |
| `label` | list 行的可读名 | `sidebar.panellist` 用它当按钮 label（`⟨A⟩\dsh-client-ui-sidebar\src\client\index.ts:58-62`） |
| `locale` | 声明字典命名空间 → 组件拿到 `t` | 未注册字典会**大声失败**（`⟨A⟩\dsh-client-ui-sidebar-right\src\client\index.ts:244`） |
| `registrant` | 诊断归属戳，缺省 `ctx.fiber.name` | `⟨A⟩\dsh-client-ui-renderer\src\client\registry.ts:481` |
| `inject` | 工厂，返回值变 props | 见 2.3 |
| `children` | 声明本组件要渲染的子 slot | 只有 owner 声明 |
| `store` | 声明的共享视图 store → `useStore`/`actions` | slots.md:93 |
| `select` | chain slot 的选择器 | 我们不用 |

## 2.3 inject 返回值怎么变 props

- 普通成员 → 原样进 props。
- **保留键 `hooks`**：其值是裸 `{ getSnapshot, subscribe }` 源，渲染器把 `hooks: { status }` 变成组件 prop **`useStatus(selector)`**，并按 source 身份缓存（`⟨D⟩\subsystems\slots.md:126-130`）。
- 组件还额外拿到框架标准 props：`sessionId`、`useSession`、`useProjection`、`useAccess`、`useConversation`、`useInput`、`inputActions`、`useResource`、`t`、`useStore`（slots.md:105-120）。

## 2.4 真实例子（已装包里的活样本）

```ts
// ⟨A⟩\dsh-client-ui-sidebar-documentpreview\src\client\index.ts:104-119 精简
ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
  { name: 'sidebar.right.pane.tab', key: TEXTPREVIEW_ID, locale: NS, store,
    inject: (sessionId, actions) => ({ ...face(sessionId, actions), hooks: { documentPreviews: source } }) },
  TextPreview,
)), 'ui-sidebar-documentpreview: text body')
```

要点：`ctx.effect(() => ...)` 把注册挂在自己 fiber 上；`inject` 第一个参数是 `sessionId`（session 作用域 slot），第二个是该 slot 声明的 store actions。

---

# 3. 右侧边栏：`sidebarRight` 与 `sidebarRightTabs` 完整 API

## 3.1 两段式注册

**第一段：tab 类型（静态）** `ctx.sidebarRightTabs.register(definition): () => void`

```ts
// ⟨A⟩\dsh-client-ui-sidebar-right\src\client\tab-registry.ts:93-139
interface SidebarRightTabDefinition {
  id: string                      // 本实现的唯一身份，body/title 都注册在它下面（用包名）
  kind: string                    // 类型判别符，openTab 用它
  multiple?: boolean              // 同 kind 允许多实例（终端类）；页面类默认一 pane 一个
  keepMounted?: boolean           // 已访问 body 跨 tab/会话/折叠/dock 保活
  patterns?: readonly string[]    // 认领 dsh-resource:// 地址的 glob；页面类型不写
  priority?: 'extension' | 'builtin' | 'fallback'   // 默认 'extension'（最高）
  canOpen?: (address: string) => boolean            // 同步否决
  title: (address: string) => string                // 打开时定格成 chip 文案
  guide?: readonly SidebarRightGuideEntry[]         // 指南页卡片（id/order/title/description/icon）
}
```
- 重复 `id` 抛；同 kind 只允许 `builtin`+`extension` 各一个（`tab-registry.ts:253-262`）。
- 返回值是幂等 disposer；内部已用 `ctx.effect` 包裹（`tab-registry.ts:270-281`）。

**第二段：body** `ctx.slots.register({ name:'sidebar.right.pane.tab', key: definition.id, ... }, Body)`
- 该 seat 声明：`kind:'keyed'`, `scope:'session'`, `hookContext: TabHookContext`, `inject: SidebarRightTabInjected`（`⟨A⟩\dsh-client-ui-sidebar-right\src\client\contract\slots.ts:59-78`）。
- body 通过框架提供的 **`useTabInfo()`** 读一切（见 3.4）。
- 可选第三段：`sidebar.right.pane.tab.title`（同 key），无注册则用开 tab 时定格的 title（README.md:86）。

## 3.2 `ctx.sidebarRight`（`ISidebarRight`，`⟨A⟩\dsh-client-ui-sidebar-right\src\client\service.ts:216-298`）

```ts
readonly mounted: ObservableSnapshot<SessionId | undefined>     // 当前屏上会话
openResource(address: string, options?: SidebarRightOpenResourceOptions): void
openTab<K extends string>(kind: K, options?: SidebarRightOpenTabOptions<K>): void
close(tabId: TabId): void
hide(tabId: TabId): void
active(): TabRecord | undefined
isExpanded(): boolean
toggleExpanded(): void
focus(tabId: TabId): void
split(paneId?: PaneId): PaneId | undefined
float(tabId: TabId, rect?: FloatRect): void
dock(paneId: PaneId): void
// 非 ISidebarRight、但在同一 controller 上（给 tab 内部用）：
openResourceIn(sessionId: SessionId, address: string, options?): void   // service.ts:403
openTabIn<K>(sessionId: SessionId, kind: K, options?): void            // service.ts:416
closeIn(sessionId: SessionId, tabId: TabId): void                      // service.ts:428
readonly openTabs: ObservableSnapshot<readonly SidebarRightOpenTab[]>  // service.ts:303
registerCloseHandler(kind, handler): () => void                        // service.ts:317
```

options（`service.ts:155-201`）：`paneId?`、`preferNewPane?`、`replaceTab?: TabId`、`revealIfOpened?`，resource 额外 `kind?`/`params?`/`destination?: 'sidebar'|'float'`，page 额外 `params?`。
- 页面类型的地址由包自己合成：**`sidebar://<kind>`**（`⟨A⟩\dsh-client-ui-sidebar-right\src\client\contract\seed.ts:45-47`），所以 `tab.contentId === 'sidebar://zotero'`。
- 打开即展开右栏；`openTab` 的 kind 没人注册会抛。
- `tab.actions`（body 内）是同一能力的会话内版本：`bindCommands`/`openResource`/`openTab`/`close`（`contract/slots.ts:156-182`）。

## 3.3 最小可跑：注册自定义 kind + 按钮打开

```ts
// src/client/index.ts —— 施工可直接照抄
import { createElement } from 'react'
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']
const ID = 'zotero-seek'            // 用包名：body/title 的 key
const KIND = 'zoteroSeek'           // openTab 用的判别符
const NS = 'zoteroSeek'

export function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh: {...}, en: {...} }), 'seek: dict')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID, kind: KIND, keepMounted: true,
    title: () => t('tabTitle'),
    // 不写 patterns = 页面类型；写了就变成"认领地址"的资源类型
  }), 'seek: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: ID, locale: NS,
      inject: (sessionId) => ({ openDetail: (id: string) => ctx.remote.zoteroSeek.detail(id) }) },
    Panel,   // Panel 收到 { sessionId, useTabInfo, inputActions, useResource, t, openDetail }
  )), 'seek: tab body')
  // 入口：composer 工具行一个按钮（session 作用域，能拿 inputActions）
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'seek.open', order: 80, locale: NS },
    () => createElement('button', { onClick: () => ctx.sidebarRight.openTab(KIND) }, '文献'),
  )), 'seek: composer button')
}
```
（入口位置取自 dsh-zotero：`conversation.input.left` + `ctx.sidebarRight.openTab(LIBRARY_TAB_KIND)`，⟨Z⟩`src/client/index.ts` 的 `disposeInputButton`。）

## 3.4 tab body 的 props：`useTabInfo()` 返回什么

```ts
// ⟨A⟩\dsh-client-ui-sidebar-right\src\client\contract\slots.ts:184-215（结构），tab-info.ts:29-55（实现）
interface SidebarRightTabInfo {
  sidebar: { expanded: boolean; fullscreen: boolean }
  panel: { id: PaneId; isFloating: boolean }
  tab: TabRecord & {
    contentId: string                    // 页面 = 'sidebar://<kind>'
    kind: string
    title: string                        // 打开时定格（除非注册了 title seat）
    visible: boolean                     // 前台会话 + 可见才 true
    navigation: { address: string; params: SidebarRightNavigationParams; revision: number }
    signal: AbortSignal                  // 记录被移除或插件卸载才 abort
    actions: SidebarRightTabActions
    refreshShortcut?: ShortcutCatalogEntry
  }
}
```
- `navigation.params` 就是你 `openTab(kind,{params})` 传进来的对象（**打开时**的，`revision` 每次导航 +1 供"再次导航"判断，`slots.ts:109-121`）。
- 类型化 params：`declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' { interface SidebarRightTabParamsMap { zoteroSeek: { itemKey: string } } }`（`contract/params.ts:31-40`；resource 侧同理 `SidebarRightResourceParamsMap`，documentpreview `index.ts:65-70` 是活样本）。运行时**不校验**（params.ts:9-11）。

## 3.5 `openTabs` 快照形状

```ts
// ⟨A⟩\dsh-client-ui-sidebar-right\src\client\tab-inventory.ts:8-20
interface SidebarRightOpenTab { sessionId: SessionId; tabId: TabId; kind: string; contentId: string }
// ctx.sidebarRight.openTabs.getSnapshot(): readonly SidebarRightOpenTab[]
// 订阅：ctx.sidebarRight.openTabs.subscribe(listener)
```
dsh-zotero 用它做"tab 还在不在"的判定（`present()` + `subscribe` abort，⟨Z⟩`src/client/index.ts` 的 `disposePdfRecovery`）——PDF/Markdown 大资源释放就靠这个。

---

# 4. 左侧栏 / 主面板入口（备选方案）

主面板 = 把**中间列整个换掉**的页面，root 作用域、**没有 sessionId**；左侧栏只是它的图标行。产品上不如右侧栏贴近会话，作为备选。

```ts
// 1) 主面板本体：main 是 keyed/root slot，保留键 'conversation'
//    声明见 ⟨A⟩\dsh-client-ui-layout\src\client\index.ts:71-75
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'zoteroSeek' }, Panel))
// 2) 左侧栏图标行：sidebar.panellist 是 list/root，id 必须等于 main 的 key
//    ⟨A⟩\dsh-client-ui-sidebar\src\client\contract\slots.ts:43-49（id 即 MainPanelId）
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: 'zoteroSeek', order: 40, label: () => t('nav') },
  Icon,   // 收到 { size: number; active: boolean }（slots.ts:102-108）
))
// 3) 打开/关闭：panelInfo 快照 + selectPanel
ctx.layout.selectPanel('zoteroSeek' as MainPanelId)   // 未注册的 key 会抛
ctx.layout.panelInfo.getSnapshot().activePanelId      // MainPanelId | null
```
- `selectPanel`/`panelInfo` 签名：`⟨A⟩\dsh-client-ui-layout\src\client\service.ts:18-36, 72-78`。
- 图标的复用 factory 是 `sidebar.panel.icon`（ui-sidebar 自己声明并渲染，`⟨A⟩\dsh-client-ui-sidebar\src\client\PanelIcon.tsx:10-11`、`index.ts:88-92`）——**我们不需要注册 factory，只注册 `sidebar.panellist` 行**。
- `openRightbar(track, fullscreen)` / `closeRightbar()` 是**右栏 seat 自己**向 frame 汇报几何的（`service.ts:44-53`；调用点在 `⟨A⟩\dsh-client-ui-sidebar-right\src\client\index.ts:220-224`）。外部插件不调用它——要显示右栏就用 `openTab`。

---

# 5. Client 怎么取 Host 数据

## 5.1 `host.call` 在我们这里**不存在**

`host.call(method, args)` 只属于 **实验性动态客户端插件**（cordis-client-runner 的纯 JS、无 import、无 fetch 沙箱世界）：`⟨A⟩\dsh-cordis-client-runner\src\client\evaluator.ts:49,71`、`providers.ts:58`。我们是安装进 profile 的普通包（有 `dsh.client` + 构建产物），**没有**这个入口。结论：不要按 `host.call` 设计。

## 5.2 官方通道：Remote（`ctx.remote`）+ Typert 声明

调用面（消费侧，照抄 `⟨A⟩\dsh-client-ui-sidebar-documentpreview\src\client\rpc.ts:15-46`）：

```ts
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
readonly workspaceFiles: {
  read(sessionId: SessionId, path: string, range: WorkspaceFileRange, signal?: AbortSignal)
    : Promise<RemoteResult<WorkspaceFileText>>
}
```
- **返回 Promise，且不 reject**：结果对象自带你声明的失败（`rpc.ts:37-40`）。成功 `{ok:true, value}`，失败 `{ok:false, error}`（dsh-zotero 里一律 `if (!result.ok) throw result.error`）。
- 命名空间必须先挂载：

```ts
// ⟨Z⟩src/client/remote.ts（声明）+ src/client/index.ts（挂载）
import type { TypertRemoteContribution, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
export const ZOTERO_REMOTE: TypertRemoteContribution = { package: 'dsh-zotero', descriptors: ZOTERO_COMMON_INVOCATIONS }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap extends ZoteroRemoteEndpointMap {}
  interface TypertRemoteNamespaceMap { zotero: TypertRemoteNamespace<'zotero'> }
}
// apply：
export async function apply(ctx) {
  const disposeRemote = await ctx.remote.$mount(ZOTERO_REMOTE)
  const ui = ctx.inject(['remote.zotero', 'slots', 'locale', 'sidebarRight', /*...*/], registerUi)
  await ui
  return async () => { await ui.dispose(); await disposeRemote() }
}
```
- 坑：`inject` 里**不要**写自己的 `remote.zotero`（fiber 会 park，永远等不到），改在 `apply` 里 `ctx.inject(['remote.zotero',...], ...)` 二次注入（⟨Z⟩`src/client/index.ts` 的 `inject` 注释，官方 consumer 形态）。
- 访问控制：`ctx.remoteAccess.whenAccess('zotero/browse', () => ...)` 只在授权时可注册（⟨Z⟩`src/client/index.ts`）。
- 成本评估：**中等偏高**。要 Host 侧定义 Typert descriptor + 注册 namespace，Client 侧 `$mount`，再加两端 schema（`⟨D⟩\subsystems\typert.md`、`api-gateway.md`）。但这是唯一官方通道；只读流式数据可再包一层 `ctx.resources.register({protocol, async *open(address,{signal})})` 给组件 `useResource` 用（`⟨D⟩\subsystems\client-resources.md:22-51`）。
- **未验证**：本机 rc.3 是否支持 dsh-zotero 用的全部 descriptor 写法（它的 pin 是 rc.4）。施工前先用最小 namespace 打通一次。

---

# 6. 会话内联动（把命中送进输入框）

**结论：用 `inputActions`，不要碰 DOM。** session 作用域的 slot 组件（含右侧栏 tab body）自动拿到三个标准 props：`useConversation`、`useInput`、`inputActions`（`⟨A⟩\dsh-client-ui-conversation\src\client\contract\slots.ts:395-411`；提供点 `apply.ts:319-335` 的 `ctx.uiSession.provide({hooks:['conversation','input'], props:['inputActions'], ...})`）。

```ts
// ⟨A⟩\dsh-client-ui-conversation\src\client\contract\input.ts:264-293
interface InputActions {
  insertQuote(text: string, summary?: QuoteSummary): boolean   // 作为 Markdown 引用块插入，返回是否接受
  captureInsertion(): TokenSpan                                // 复制当前选区（带 draftRev 守卫）
  insertText(text: string, span: TokenSpan): boolean            // 插入纯文本（一次 undo 步）
  setDraft(text: string): void                                  // 整段替换草稿（会清掉引用 chip）
  persistDraft(): void
  addAttachments(ids: readonly DraftAttachmentId[]): boolean
  removeAttachment(id: DraftAttachmentId): void
  pruneAttachments(ids: readonly DraftAttachmentId[]): void
  submit(): void                                                // 走正规提交管线
}
```

推荐用法：
- **「提到对话」**：`inputActions.insertQuote(markdownText, 'ZoteroSeek：<标题>')` —— 用户看到摘要，实际发送是 blockquote。
- **「复制引用」**：`await navigator.clipboard.writeText(citation)`，失败走你自己的 toast（`writeClipboard` 在 primitives 里，按规范不用）。
- **不要**用 `setDraft` 覆盖用户正在写的内容；`insertText` 要配 `captureInsertion()` 的 span，stale 返回 `false` 自己重试（input.ts:274-280）。
- 想"直接以用户消息注入一次提问"：`setDraft(prompt)` + `submit()`。注意 `submit` 是真实提交（会开一轮对话、消耗 token），必须由用户点击触发。
- `ctx.input` / `ctx.composer` 这类客户端服务**不存在**（本机 grep 无此 service）；`conversation.input.*` 都是 slot seat，不是服务。

---

# 7. Markdown 渲染的限制与选择

- **没有任何受支持的 markdown 渲染服务**。基线模块表（1.2 节）里没有 markdown 库；UI 里的渲染器是 `MarkdownText`，仅在 `@deepseek-ai/dsh-client-ui-primitives`（`⟨A⟩\dsh-client-ui-chat\src\client\chat\AssistantMarkdown.tsx:5`），而 primitives ①没作为包安装（`⟨A⟩\dsh-client-ui-primitives` 不存在，只有运行时表）②被官方规则禁用于插件（`⟨SK⟩\references\practices.md:35`）。
- 唯一"官方"渲染入口是 `conversation.chat.markdown.fence` 这类 **hoc 贡献位**（给自己加 fence 语言渲染），不是可复用的渲染器；且只作用于对话区（`⟨A⟩\dsh-client-ui-chat\src\client\apply.ts:247`、`slots.md:161-171`）。
- dsh-zotero 的选择：**自带纯解析闭包**，全部内联进 client bundle —— `mdast-util-from-markdown` / `mdast-util-gfm` / `mdast-util-math` / `micromark-extension-gfm` / `micromark-extension-math` / `katex` / `markdown-table` / `clsx`（⟨Z⟩`scripts/client-graph-authority.mjs` 的 `CLIENT_INLINE_PACKAGES`），并为此设了 800KiB 体积红线（⟨Z⟩`scripts/build-client.mjs` 的 `MAX_CLIENT_BUNDLE_BYTES`，实测约 750KB）。
- 它还额外做了一层 MinerU 兼容：MinerU 的 Markdown 里混**内联 HTML**（上下标、加粗、整张表格），而"host renderer deliberately parses no HTML"，所以先正则投影成 `$^{\text{..}}$` / `**..**` / `*..*` 并剥掉其余标签，代码围栏原样保留（⟨Z⟩`src/client/parsed-markdown.ts` 全文）。
- **建议（按成本）**：
  1. 先写轻量渲染器（本项目要的只有：标题、段落、列表、表格、`$..$`/`$$..$$`、`![](path)` 插图、代码块）。MinerU 输出结构稳定，正则+递归切块足够；公式若需好看再引 KaTeX。
  2. 要 GFM 完整语义才内联 mdast 闭包（+~700KB，构建时间与包体都要管）。
  3. **不要** require primitives 换一时的省事——它随时改，且抛错会让面板整块空白（`practices.md:35`）。
- **未验证**：本机是否已有可直接复用的 markdown 渲染 slot 给任意面板用（`Slots.listSubTree` 需要连上页面才能查；本次 client inspect 全部超时，见 §10）。

---

# 8. 样式

## 8.1 theme token 清单（`--dsw-*`）

两层：`--dsw-static-*` 调色板（light 定义在 `body`，dark 覆盖在 `body[data-ds-dark-theme]`），`--dsw-alias-*` 语义层。来源：`⟨A⟩\dsh-client-ui-theme\src\styles\design-platform.css:4-88`（static，light）、`:177-307`（alias，light）、`:329-...`（alias，dark）；`⟨A⟩\dsh-client-ui-theme\src\styles\base.css:9-23`（字体/圆角）。

我们面板要用的子集（这些是**稳定引用面**，改名的 token 只会掉色不会崩，`practices.md:34`）：

| 用途 | token |
|---|---|
| 面板/卡片底色 | `--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1/2/3`、`--dsw-alias-card-fill`、`--dsw-alias-card-fill-hover` |
| 文字 | `--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-label-tertiary`、`--dsw-alias-label-caption` |
| 边框/分割 | `--dsw-alias-border-l1/l2/l3/l4`、`--dsw-alias-border-selected` |
| 交互态 | `--dsw-alias-interactive-bg-hover`、`--dsw-alias-interactive-bg-active`、`--dsw-alias-interactive-bg-hover-solid` |
| 主按钮/链接 | `--dsw-alias-button-primary-fill`、`--dsw-alias-button-primary-hover`、`--dsw-alias-link` |
| 选中/强调 | `--dsw-alias-state-business-primary`、`--dsw-alias-trajectory-accent`、`--dsw-alias-brand-primary` |
| Markdown 区 | `--dsw-alias-markdown-code-block`、`--dsw-alias-markdown-code-block-banner`、`--dsw-alias-markdown-inline-code`、`--dsw-alias-markdown-citation`、`--dsw-alias-markdown-tag` |
| 滚动条 | `--dsw-alias-scrollbar-bg-l1`、`--dsw-alias-scrollbar-hover-l1` |
| 圆角 | `--dsw-radius-xs 4px / sm 8 / md 12 / lg 16 / xl 20 / panel 28` |
| 字体 | `--dsw-font-family`、`--dsw-font-family-brand` |
| 错误/成功提示 | `--dsw-alias-state-error-primary`、`--dsw-alias-state-success-primary` |
> 更权威的取法是运行时 `cordis_inspect_query({platform:'client', provider:'Theme', method:'listTokens'})`（`⟨SK⟩\references\practices.md:34`）；本次会话该 client 查询**超时未验证**，上表来自已安装 theme 包的 CSS。

## 8.2 CSS 注入方式

三种合规做法（推荐 a + c 组合）：

**a) 组件内渲染 `<style>`**——最省事、随卸载消失：`⟨SK⟩\references\ui-plugin.md:13`「Component-local styles can render as React elements so unmounting removes them」。

```tsx
const CSS = `.zseek-root{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}`
function Panel() { return <div className="zseek-root"><style>{CSS}</style>…</div> }
```
**b) 模块 materialize 时插一个 `<style data-plugin-css="zseek/panel">`**——loader 会把 factory 期间新增的无主 `<style>` 认领给本包，卸载时清掉（`⟨A⟩\dsh-client-modules\src\client\system.ts:66-86`）。这是 dsh-zotero 构建期 CSS Module 的做法（每个模块一条 style，带 `data-plugin-css`，⟨Z⟩`scripts/build-client.mjs` 的 `cssModulesPlugin`）。

**c) 没构建期 CSS Module 时的推荐做法**：所有类名加包前缀 `.zseek-*`，单一 `<style>` 里写全，值只写 `var(--dsw-*)`。**禁止**：写 `document.body` / `html` 样式、改别的插件的 DOM 与样式表、用 iframe 承载（iframe 拿不到主题与 `ctx.locale`，`practices.md:33`）。

---

# 9. 本地图片显示（MinerU 插图）

MinerU 转出的 Markdown 里插图是相对路径（如 `images/xxx.jpg`），需要一个能进 `<img src>` 的 URL。两条路：

**A. 不走 HTTP（推荐，最省事最安全）**：Host 用 Remote 返回 bytes（或 base64），Client 造 blob URL。

```ts
const res = await ctx.remote.zoteroSeek.figure({ sessionId, docId, path })
if (!res.ok) throw res.error
const url = URL.createObjectURL(new Blob([res.value.bytes], { type: res.value.mime }))
// <img src={url}> ；组件 unmount 时 URL.revokeObjectURL(url)
```
依据：Remote 面能返回二进制（`⟨A⟩\dsh-client-ui-sidebar-documentpreview\src\client\rpc.ts:85-93` 的 `DocumentFileBytes` / `readBytes`）。优点：零路由、零鉴权、天然同源。缺点：大图要自己管内存与缓存。

**B. Host 注册 HTTP 前缀路由 + Connection 鉴权**（要和 host-api 那份衔接时用）：

```ts
// 参考 ⟨A⟩\dsh-experimental-inspector\src\host\plugin.ts:94-117
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix', path: '/zotero-seek/media',
  handler: (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return }
    const rejection = ctx.connection.requestRejection(req)   // 401 / 403，或 undefined 表示放行
    if (rejection !== undefined) { res.writeHead(rejection).end(); return }
    // 只按不透明 id 查表 → 读文件 → 写 content-type / cache-control
  },
}), 'zseek: media route')
```
- URL 形态：同源相对路径，`/zotero-seek/media/<opaqueId>`。**不要**把绝对文件路径拼进 URL（路径泄露 + 目录遍历面）。
- 鉴权真相：`ctx.webServer` 载体**自己不做鉴权/Origin 策略**，是 `dsh web` 组合里的 Connection 插件为"每个 Host API 路由与流"提供 Host/Origin 校验 + 浏览器会话鉴权（`⟨D⟩\subsystems\web-server.md:102`）；`requestRejection(request)` 就是"把 Connection 的校验套到另一个 Web 路由上"（同文件 `:132-140`），`admit()` 则返回 Peer（`:140-146`）。`/api` 是 Connection 的共享 RPC 通道（`web-server.md:102`），**不适合**当原始字节出口。
- `<img>` 无法带自定义头，只能靠同源 cookie —— 所以 B 方案必须在浏览器已登录该 GUI 的会话里（Desktop 即本机 GUI，成立）。
- 包自带的静态资源走 `/plugins/<package>/assets/<path>`（`⟨A⟩\dsh-client-modules\README.md:39`），只能服务 `exports` 里发布过的文件，**不能**服务 MinerU 输出目录；图片自己的图标可以用它（`require.asset('plugins/<pkg>/assets/icon.svg')`，`system.ts` 的 `resolveAsset`）。
- **未验证**：`⟨A⟩\dsh-client-ui-sidebar-documentpreview\src\client\image\` 下图片预览类型的具体渲染方式（未逐行读）；以及 rc.3 下 `requestRejection` 对 `<img>` 请求的 cookie 判定行为（需页面实测）。

---

# 10. 验证：确认面板真的渲染了

## 10.1 无浏览器控制时（cordis_inspect_query）

```
cordis_inspect_query({ platform:'client', provider:'Slots', method:'listSubTree', input:{ root:'sidebar.right.pane.tab' } })
cordis_inspect_query({ platform:'client', provider:'Slots', method:'listSubTree', input:{ root:'main' } })
cordis_inspect_query({ platform:'client', provider:'Slots', method:'listSubTree', input:{} })   // 全树
cordis_inspect_query({ platform:'client', provider:'Theme', method:'listTokens' })
```
看什么：目标 slot 的 **occupants** 里有没有你的 `key`/`id`、`inject` 声明是否在、Factory 节点的 `registrant` 是不是你（provider 清单与 schema 见 `cordis_inspect_list` 输出：Slots 的 `root` 参数是"精确 Slot key 或 `factory:<name>`"）。

**本次会话状态**：`Service.listService` / `Slots.listSubTree` / `Theme.listTokens` 三个 client 查询**全部 10s 超时**（原文 `Client inspect query ... timed out after 10000ms. Open or reconnect the Harness page, then retry.`）。→ **未验证**。重试步骤：确认 GUI（`http://127.0.0.1:62159`）已打开并连上 Host → 重新 `cordis_inspect_list` → 再查一次；仍超时则改用 10.2 的运行时手段。

## 10.2 有页面时（浏览器 console / DOM）

- 组件 render 或 `inject` 工厂抛错 → console：`slot entry crashed in '<slotKey>':`，同时 DOM 留下 `data-slot-error="<slotKey>"` 标记（`⟨A⟩\dsh-client-ui-renderer\src\client\scoped-slots.tsx:459,465`）；Factory 场合是 `slot factory occurrence crashed in '<name>'` + `data-factory-error`（`:482,486`）。
- 快速自检脚本（复制到 console）：`[...document.querySelectorAll('[data-slot-error],[data-factory-error]')].map(e => e.getAttributeNames().map(n=>n+'='+e.getAttribute(n)).join(' '))`
- 也可以在插件里自己接：`ctx.slots.onEntryError((key, registration, error, info) => ...)`，用 `registration.registrant === '你的包名'` 过滤自己的条目（⟨Z⟩`src/client/index.ts` 的 `isZoteroRegistration` + `registerSharedSurfaces`）。
- 注册面查询：`ctx.slots.entriesOfSlot('sidebar.right.pane.tab')`、`ctx.slots.subscribe(key, listener)`（`⟨A⟩\dsh-client-ui-sidebar\src\client\index.ts:58-75` 用法）。

## 10.3 施工期最小验证顺序（建议照走）

1. **产物**：bundle 能注册且 factory 可执行（§1.4 的 JSDOM 自检），`id === package.json name`。
2. **激活**：Settings → Plugins 里该行 enabled 且无红色错误；Host 侧 console 无 `client-modules: ... failed to load`。
3. **类型注册**：`Slots.listSubTree {root:'sidebar.right.pane.tab'}` 里有你的 `key`。
4. **打开**：点按钮后 `ctx.sidebarRight.openTabs.getSnapshot()` 出现 `{kind, contentId:'sidebar://zoteroSeek'}`。
5. **渲染**：console 无 `slot entry crashed`；DOM 无 `[data-slot-error]`；切 light/dark 各看一次。
6. **数据**：Remote 调用失败会走 `{ok:false}`，面板必须显示错误而不是空白。
7. **释放**：关 tab / 折叠右栏后 `openTabs` 里条目消失、`URL.revokeObjectURL` 被调、Remote 的 AbortSignal 已 abort。

---

# 11. 给施工的硬性结论清单

1. 产物 = `window.__ModuleLoader__.load({id: 包名, factory(require){...}})`，esbuild `cjs` + banner/footer；React 家族从表里 require，**不要**声明 `external`；`jsx-runtime` 在表里，`jsx-dev-runtime` 不在。
2. 面板 = 右栏两段式：`ctx.sidebarRightTabs.register({id,kind,title,...})` + `ctx.slots.register({name:'sidebar.right.pane.tab', key:id, locale, inject}, Body)`；body 里 `useTabInfo()` 拿 `contentId/params/revision/actions`，`inputActions.insertQuote()` 实现"提到对话"。
3. 数据 = `ctx.remote.<ns>`（`$mount` + Typert），**没有** `host.call`；Markdown 必须自带渲染器（基线无渲染库，primitives 禁用）；图片优先 blob URL，走 HTTP 就必须自己用 `ctx.connection.requestRejection` 鉴权。
