---
type: 调研
tags: [ZoteroSeek, DSH, 插件, Host API, 施工说明]
主题: DSH Host 插件 API 施工说明
创建日期: 2026-11-18
状态: 调研完成（基于本机已安装的 DSH 0.2.2-rc.3）
---

# 调研基线（先读这一节）

安装版本与路径（全部为本机实测）：

| 记号 | 绝对路径 | 说明 |
|---|---|---|
| `$DSH` | `D:\DeepSeek Harness\resources\app.asar\dsh` | 运行中的 CLI 包根（`package.json` 第 4 行：`0.2.2-rc.3`） |
| `$NM` | `$DSH\node_modules\@deepseek-ai` | 全部内置包源码（`src/` 为 TS 原文，`lib/` 为构建产物） |
| `$SKILL` | `$NM\dsh-agent-preset\skills\dsh-doc` | dsh-doc 文档与模板 |
| `$PROFILE` | `C:\Users\kingfloyd\.dsh\profiles\desktop` | 当前 profile；`package.json` + `cordis.patch.yml` 属于用户，**不要写** |
| `$HOME` | `C:\Users\kingfloyd\.dsh` | `DSH_HOME`（`DSH_HOME` 环境变量为空时取 `~/.dsh`） |

已核实：`DSH_PROFILE=desktop`；`$PROFILE\node_modules\@deepseek-ai` 为空（无第三方插件）；profile 已挂载 `webServer`、`client-modules`、`client-connection`、`api-remotes`、`ui-plugin-manager`（`$NM\dsh-web-app\cordis.patch.yml:184,232,239,252,341`），下文所有 Host 服务在桌面版可用。`cordis_inspect_query(host/Service)` 是本机权威签名来源；`cordis_inspect_query(client/*)` 本次**超时不可用**（页面未连接），Client 结论均来自源码并标注。

核心判断：① 一个 bundle 用**一行 patch** 同时拥有 Host+Client 两半，`dsh.client` 写在 `package.json`；② 本地 bundle 首选**零依赖纯 JS**（实测从 `E:\TheCode\ZoteroSeek` 解析 `@deepseek-ai/*`、`zod` 均 `MODULE_NOT_FOUND`，且本地目录安装是链接）；③ 包私有 RPC 用 `ctx.connection.rpc.handle` + client `connection.rpc.call`，**不要用 `host.call`**（它只属于动态 Cordis 包体系）。

# 1. Bundle 的 package.json（Host + Client 双半）

## 1.1 完整真实例子（可直接起步）

```json
{
  "name": "@local/zotero-seek",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Zotero library + MinerU parsed Markdown inside DeepSeek Harness.",
  "icon": "./icon.svg",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "docs", "icon.svg"],
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-sidebar-right"]
    }
  }
}
```

依据：Host-only 最小清单 `$SKILL\references\host-plugin.md:9-18`；双半模板 `$SKILL\templates\decoration\package.json:1-21`；真实双半 bundle `$NM\dsh-deepseek-chat-import\package.json:17-41,113-128`；字段语义 `$NM\dsh-package-manifest\src\types.ts:31-100`。
## 1.2 每个字段的准确含义

| 字段 | 必需 | 含义 / 施工要点 | 来源 |
|---|---|---|---|
| `name` / `version` | 是 | 插件身份；`name` 同时是 Client module id、patch 行 `name` 的解析目标 | `types.ts:8-13` |
| `type` | 建议 `"module"` | Host 入口按 ESM `import()` 加载 | `host-plugin.md:14` |
| `exports["."]` | 是 | Host 入口文件 | `host-plugin.md:15` |
| `exports["./client"]` | 有 Client 半时必需 | 浏览器 bundle；Host 在 `/plugins/<pkg>/client.js` 提供 | `dsh-client-modules\README.md:34,43` |
| `exports["./locale/*.json"]` / `exports["./icon"]` 或顶层 `icon` | 建议 | Plugin Manager 未激活插件也能读标题/描述；顶层 `icon` 优先，SVG/PNG/JPEG/WebP ≤256 KiB 且在包内 | `host-plugin.md:31-43,47,52`；`types.ts:15` |
| `files` | 打包时必需 | packed 安装才过滤；**本地目录安装是链接，`files` 不过滤** | `host-plugin.md:36` |
| `dsh.bundle.patch` | 是（否则不是 bundle） | 字符串或有序数组，路径相对包根 | `types.ts:70-78` |
| `dsh.bundle.platforms` | 否 | 缺省=所有 OS；不支持的 Host 上 bundle 可见但不能启用 | `types.ts:72` |
| `dsh.client.platform` | 是（有 Client 半时） | 字符串；Web 消费者选 `'web'`（桌面版页面也是 web 平台） | `types.ts:87-89` |
| `dsh.client.inject` | 否 | **只是包名依赖边**：让这些行的 factory 先到、影响组装顺序；**不是服务注入** | `types.ts:90-91`；`manifest.ts:44-50` |
| `dsh.client.immediately` | 否 | 布尔，stage-one 预取：boot 期间就抓 `client.js` 注册 factory（body 延迟执行） | `types.ts:92-93`；`manifest.ts:63-65` |
| `dsh.client.external` | 否 | 精确的非 baseline 模块表请求（含 `<pkg>/client` 子路径）；baseline 指 React 等共享模块 | `types.ts:94-99`；`dsh-client-modules\README.md:55` |
| `engines.dsh` | 慎用 | 运行的 DSH 版本必须满足；本机 `0.2.2-rc.3`，写 `>=0.2.2-rc.4` 会**安装即被拒** | `types.ts:58-68`；`$NM\dsh-plugin-manager\src\tools.ts:89` |

Client 半的**服务注入**（`inject: ['slots','locale','connection','remote']`）写在 client.js 的 factory 返回值里，不是 `dsh.client.inject`（`$SKILL\templates\decoration\client.js:13-15`；`$NM\dsh-deepseek-chat-import\src\client\mount.ts:14-15`）。

**locale 与 icon**：`locale/en.json`（`zh.json` 同形）：`{ "meta": { "title": "Zotero Seek", "description": "Search the local Zotero library and read MinerU-parsed Markdown with citations.", "detail": "docs/DETAIL.md" } }`。`meta.detail` 可选，文件须在包内、≤1 MiB，缺失显示失败而不是回退 README（`host-plugin.md:31-34`）。

# 2. cordis.patch.yml：insert / override / 子组件 / disabled

## 2.1 插件自己的行 + Config 默认值

```yaml
- insert:
    - id: zotero-seek
      name: '@local/zotero-seek'
      config:
        zoteroApiUrl: http://127.0.0.1:23119/api/users/0
        mineruBaseUrl: https://mineru.net/api/v4
        cacheDir: !!js dshHomePath('zotero-seek')
        requestTimeoutMs: 180000
```

- 行字段：`id`、`name`、可选 `config`、`disabled`、`inject`、`intercept`、`isolate`（`$SKILL\references\composition-reference.md:13`）。
- `!!js` 是 Loader 表达式：在该插件注入的服务生效后对其 ctx 求值，`dshHomePath(...)` 可用（`composition-reference.md:17`；`ctx.provide('dshHomePath', …)`：`$NM\dsh-app-boot\src\index.ts:1243`；求值器 `with(ctx)`：`$NM\cordis-plugin-loader\src\config\utils.ts:5-9`）。
- 用户覆盖 Config：写同名 `id` 的 override。**`config` 整体替换、不深合并**，必须重写全部字段（`composition-reference.md:10`；`$NM\dsh-base\cordis.patch.yml:5-10`）：`- id: zotero-seek` + `name` + 完整 `config`。

## 2.2 多行 / 子组件 row

1. **子路径包**（推荐「主插件 + 可选 MinerU 组件」）：行 `name` 用子路径，`package.json` 加 `"@local/zotero-seek/mineru": "./mineru.js"` 等 exports。真实先例 `dsh-zotero` 的 `/library`、`/scholarly`、`/enrichment` 三行（`https://raw.githubusercontent.com/VncntVx/dsh-zotero/main/cordis.patch.yml`），子路径各自再有 `locale/*.json`/`icon`（`host-plugin.md:52`）。
2. **group 行**（一段配置挂多个插件，可按 id 再插行）：真实样例 `$NM\dsh-experimental-ralph-bundle\cordis.patch.yml:1-16`：

```yaml
- insert:
    - id: optional-zotero-seek
      name: cordis:group
      group: true
      config:
        - id: zotero-seek-core
          name: '@local/zotero-seek'
          config: { requestTimeoutMs: 180000 }
        - id: zotero-seek-mineru
          name: '@local/zotero-seek/mineru'
          config: { mineruBaseUrl: https://mineru.net/api/v4 }
```

向已存在 group 插行、`cordis:include` 从 `config.path` 读 YAML/JSON 条目列表：`composition-reference.md:9,15`。3. 多个独立 bundle/行（一般不需要 `inject`：激活由服务可用性驱动，行序无加载语义，`$NM\dsh-base\cordis.patch.yml:12-13`）。

## 2.3 disabled 语义

- 布尔、`null` 或 `!!js`；每次 mount 决策重新求值（`composition-reference.md:16`）。
- disabled 行**可省略必需 `config`**（`group: true` 强制激活除外）；`name` 仍须可解析。
- 打开默认关闭的行写 `disabled: false` override（`$SKILL\references\plugin-development.md:11-13`）；用户在 Plugins 页的开关会写回 profile 的 `cordis.patch.yml`（`$NM\dsh-plugin-manager\README.md:40`）。

# 3. Host 入口 index.js：apply / inject / Config

导出二选一、不可混用（`$SKILL\references\host-plugin.md:58-65`）：`export function apply(ctx, config) {}` + 可选 `export const inject`/`export const Config`；或 default export 一个 Service 类。所有注册在 `apply` 内完成，用 `ctx.effect(() => ..., 'label')` 或注册返回的 disposer，插件卸载即回收（`host-plugin.md:65`；`$SKILL\references\practices.md:8`）。

## 3.1 零依赖 Host 骨架（可直接抄）

```js
// index.js —— Host 半：只用 ctx 服务与 node: 内置模块
export const name = 'zotero-seek'
export const inject = ['tools', 'systemPrompt', 'llm', 'agentDefaultModel', 'connection', 'webServer']

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'zotero-seek',
    validate(raw) {
      const value = {
        zoteroApiUrl: raw?.zoteroApiUrl ?? 'http://127.0.0.1:23119/api/users/0',
        mineruBaseUrl: raw?.mineruBaseUrl ?? 'https://mineru.net/api/v4',
        cacheDir: raw?.cacheDir ?? '',
        requestTimeoutMs: raw?.requestTimeoutMs ?? 120000,
      }
      if (typeof value.zoteroApiUrl !== 'string') return { issues: [{ message: 'zoteroApiUrl must be a string', path: ['zoteroApiUrl'] }] }
      if (typeof value.requestTimeoutMs !== 'number' || value.requestTimeoutMs < 1000) return { issues: [{ message: 'requestTimeoutMs must be a number >= 1000', path: ['requestTimeoutMs'] }] }
      if (value.cacheDir === '') return { issues: [{ message: 'cacheDir is required (set it in cordis.patch.yml)', path: ['cacheDir'] }] }
      return { value }
    },
  },
}

export function apply(ctx, config) {
  ctx.logger.info('zotero-seek: cacheDir=%s', config.cacheDir)
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tool:zotero-seek',
    order: 2500,
    text: 'Zotero 引用规则：回答中每条文献信息必须来自本次 zotero_search / zotero_read 的返回；不得凭记忆补全作者、年份或 DOI。找不到就直说没找到。',
  }), 'zotero-seek: prompt section')
  ctx.tools.register(makeSearchTool(ctx, config))   // 第 4.3 节
  registerHostRoutes(ctx, config)                    // 第 5、6 节
}
```

## 3.2 Config 校验：Standard Schema（不是 zod 专用，也不是手写 JSON Schema）

Loader 激活时执行 `runtime.Config['~standard'].validate(config)`，同步、失败抛 `ValidationError`（`$NM\cordis\src\fiber.ts:42-62`）。因此：任何实现 Standard Schema v1（`{ '~standard': { version: 1, vendor, validate } }`）的对象都行，**上面手写版零依赖**；内置包用 `@deepseek-ai/schemastery` 的 `Schema.object({...})`，它自己实现 `~standard`（`$NM\schemastery\src\index.ts:290-307`；真实 Config：`$NM\dsh-tool-todo\src\index.ts:22-23,29-43`、`$NM\dsh-deepseek-chat-import\src\index.ts:55-66`）。异步校验不支持（`fiber.ts:54-56`）；行没写 `config` 时 `apply` 收到 `undefined`，Config 需兜底默认值。

**Config ≠ 设置页**：Config 的持久值只在 `cordis.patch.yml`；运行时修改用 `ctx.fiber.entry` + `ctx.get('configEditor')?.edit(entry, current => next)`，普通字段重启该插件、`.volatile()` 字段原地更新（`$SKILL\references\configuration.md:3-12`）。设置页界面**不会**从 Config 自动生成：Client 半自己注册 slot，bundle 级 `plugins.bundle.config`（key=包名）或行级 `plugins.row.config`（key=`包名#行id`），渲染 `view: 'page' | 'summary'`（`$NM\dsh-client-ui-plugin-manager\README.md:87-99`）。供 agent 读取的 Config JSON Schema 由 Inspect `Config.listConfigs` 投影（`$NM\dsh-tool-cordis\src\config.ts:84-120`），schemastery 的投影最完整。

# 4. ctx.tools.register：ToolDefinition 与执行契约

## 4.1 签名与注册检查（本机 inspected）

```ts
// cordis_inspect_query(host/Service, service: 'tools')
register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): () => void
restrict(filter: ToolRestriction): () => void
guard(guard: ToolGuard): () => void
get(name, scope?, toolSet?): ToolDefinition | undefined
definitions(scope?, toolSet?): readonly ToolDefinition[]
```

`register` 硬检查：必须有 `output {schema, render}`；`output.schema` 必须是受支持的 JSON Schema；`timeoutMs` 若给必须正有限；`run_code` 保留名不可用（`$NM\dsh-tools\src\index.ts:121-153`）。注册即生效、由调用方 fiber 拥有（`$NM\dsh-tools\README.md:30-32,71`）。

## 4.2 ToolDefinition 完整字段（`$NM\dsh-tools\src\contracts.ts:17-103`）

```ts
interface ToolDefinition extends ToolSchema {  // ToolSchema = { name, description, parameters: Record<string, unknown>, deferLoading?: true }
  readonly output: {
    readonly schema: JsonSchemaNode                      // 成功值的规范输出 schema，强制执行
    render(args: unknown, value: JsonValue): ContentBlock[]   // 模型/UI 内容，通常是 [{ type: 'text', text }]
    presentationMeta?(args, value): JsonValue            // 持久化到 tool/result 的 UI 元数据
  }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>   // 只返回 output.schema 声明的 JSON 值
  projectContent?(exec, result): ContentBlock[] | undefined
  finalizeContent?(exec, result): ContentBlock[] | undefined
  timeoutMs?: number            // 只声明；由 tool-call-timeout-policy 强制执行（第 7 节）
  isConcurrencySafe?(args): boolean
  presentCall?(args): ToolCallView | undefined
  presentResult?(args, result: ToolResult): ToolResultView | undefined
}
```

- 入参：`args`（模型参数；`defineTool` 会先按 DSL 校验，手写 definition **没有入参校验**，需自己验——pipeline 只校验输出值，`$NM\dsh-tools\src\pipeline.ts:544-547`）；`exec`（`ToolRunContext`：`callId`、`rootCallId`、`agent?`、`toolSet?`、`signal`、`deferContext(UserMessage)`、`concludeTurn()`，`contracts.ts:175-262`）。
- 出参：**纯 JSON 规范值**，模型可见文本由 `output.render` 生成；抛错即失败，模型看到 `Error: <message>`（`$NM\dsh-tools\README.md:178-180`）。
- 取消：必须观察/转发 `exec.signal`；未启动即取消=`ABORTED_BEFORE_DISPATCH`，执行中取消=`ABORTED`（`contracts.ts:264-268`）。结构化失败可用 `HarnessError`/`ToolErrorInfo`（`contracts.ts:270-337`）。
- 输入校验错误用 `ToolArgsError`（`$NM\dsh-tool-fs\src\read.ts:42-47`）；返回值不合 schema 变 `INVALID_TOOL_OUTPUT`（`contracts.ts:327-337`）。

## 4.3 真实注册示例（零依赖形态，推荐）

```js
function makeSearchTool(ctx, config) {
  return {
    name: 'zotero_search',
    description: 'Search the local Zotero library. Returns item keys, titles, creators, years, attachment paths. Every citation must come from these results.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: {
        query: { type: 'string', description: 'Title/author/full-text words; Zotero quick-search syntax accepted.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum items; default 10.' },
        collection: { type: 'string', description: 'Restrict to one collection key.' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['key', 'title'],
        properties: { key: { type: 'string' }, title: { type: 'string' }, year: { type: 'string' }, creators: { type: 'string' }, pdf: { type: 'string' } },
      } } } },
      render(args, value) {
        const lines = value.items.map(i => `- [${i.key}] ${i.title}${i.year ? ` (${i.year})` : ''}`)
        return [{ type: 'text', text: lines.length === 0 ? 'No matching item.' : lines.join('\n') }]
      },
    },
    timeoutMs: 30000,
    async execute(args, exec) {
      if (typeof args.query !== 'string' || args.query.trim() === '') throw new Error('query must be a non-empty string')
      const limit = Math.min(Math.max(args.limit ?? 10, 1), 50)
      const res = await fetch(`${config.zoteroApiUrl}/items?q=${encodeURIComponent(args.query)}&limit=${limit}`, { signal: exec.signal })
      if (!res.ok) throw new Error(`Zotero local API answered ${res.status}`)
      return { items: (await res.json()).map(toItem) }   // 必须匹配 output.schema
    },
  }
}
```

`defineTool` 只多出「DSL+入参校验+类型推断」，要用它需在 bundle 自己的 `node_modules` 里有 `@deepseek-ai/dsh-tools`（第 0 节实测默认没有）：形状 `$NM\dsh-tools\src\schema.ts:483-546,555-633`，文档示例 `$NM\dsh-tools\README.md:38-62`，真实工具 `$NM\dsh-tool-fs\src\read.ts:68-75`。

## 4.4 可见性与权限

| 机制 | 作用面 | 来源 |
|---|---|---|
| `register(def, { when })` | 每步按 `{ agent, modelSelection, signal }` 开关；false 时 schema 与执行都不可见；抛错= `TOOL_ACTIVATION_FAILED` | `contracts.ts:116-125`；`dsh-tools\README.md:66-73` |
| `ctx.tools.restrict({allow, deny})` | 只能**收窄**继承的全局工具；必须在 `agent.ctx` 调用，全局调用抛错；mask 相交、scoped 注册不受影响 | `index.ts:155-177`；`dsh-tools\README.md:86-88` |
| `ctx.tools.guard(fn)` | 单调否决，晚注册不能翻案；返回 reason 即拒绝 | `contracts.ts:402-418`；`dsh-tools\README.md:90-94` |
| `agent.ctx` 注册 | 按 agent 隔离的私有工具：在 `agent/created` 拿 `agent.ctx`；注册随 agent 销毁回收，插件卸载不自动销毁，disposer 要另挂插件 effect | `$SKILL\references\practices.md:14,19` |
| `toolSet` | 单步准入集合，`ctx.tools.resolve()` 产出、批末释放 | `contracts.ts:127-137` |

# 5. Host ↔ Client 包私有 RPC

## 5.1 `host.call` 的真相（重要纠偏）

`host.call(method, args)` **不属于已安装 bundle 的 Client 半**：它是「动态 Cordis 包」体系，Host 半在 `node:vm` 里用 `harness.handle(method, fn)` 注册，浏览器半用 `host.call` 调回（`$NM\dsh-cordis-client-runner\README.md:32,76`；`$NM\dsh-cordis-host-runner\src\guard.ts:595-616`；`$NM\dsh-cordis-client-runner\src\client\evaluator.ts:25,49`）。桌面 profile 确实挂载该 runner（`$NM\dsh-web-app\cordis.patch.yml:161-168,255-256`），但它是 `cordis` 工具/运行面板的动态定义，不是 `install_bundle` 的 bundle。

bundle 的 Client 半取 Host 数据四条路：

| 方案 | 复杂度 | 适用 | 来源 |
|---|---|---|---|
| A. `ctx.connection.rpc.handle` + client `connection.rpc.call` | 低 | 纯 JSON 请求/响应（检索、读 Markdown、勾选引用） | 5.2 |
| B. `ctx.connection.fetch.register` + 浏览器 `fetch`/`<img>` | 低 | 字节、流、原生浏览器加载 | 第 6 节 |
| C. Typert Remote（`@Remote` + `ctx.remote.$mount`） | 高 | 需生成物 `./typert`、`./remote`；生成器不在安装里 | 5.3 |
| D. 裸 `ctx.webServer.register` | 低但**无鉴权** | 公开静态资源；用户数据不要用 | 第 6 节 |

## 5.2 方案 A：通用 Connection RPC 通道（推荐）

Host 侧签名（`$NM\dsh-client-connection\src\rpc.ts:168-203,132-147`；实现 `src\rpc-host.ts:253-277`）：

```ts
handle(channel: string, handler: ConnectionRpcHandler): () => Promise<void>
// channel 必须匹配 /^\/[A-Za-z0-9._~-]+$/
// handler(endpoint: string, payload: unknown, signal: AbortSignal, peer: PeerScope)
//   => Promise<{ ok: true; value: unknown } | { ok: false; error: { code; message; details } }>
```

```js
export function registerHostRoutes(ctx, config) {
  ctx.connection.rpc.handle('/zotero-seek', async (endpoint, payload, signal, peer) => {
    try {
      switch (endpoint) {
        case 'search': return { ok: true, value: await searchLibrary(ctx, config, payload, signal) }
        case 'read-markdown': return { ok: true, value: await readParsed(config, payload, signal) }
        case 'cite': return { ok: true, value: { citation: formatCitation(payload) } }
        default: return { ok: false, error: { code: 'zotero-seek/unknown-endpoint', message: `unknown endpoint ${endpoint}`, details: {} } }
      }
    } catch (error) {
      return { ok: false, error: { code: 'zotero-seek/failed', message: String(error?.message ?? error), details: {} } }
    }
  })
}
```

Client 侧（`client.js` 内，`inject: ['connection']`）：`ctx.connection.rpc.call(channel, endpoint, payload, signal)`，签名与返回 `$NM\dsh-client-connection\src\rpc.ts:294-309`，实现（POST 相对 URL + JSON envelope + 非 2xx 抛错）`src\client\rpc.ts:34-81`：

```js
const result = await ctx.connection.rpc.call('/zotero-seek', 'search', { query: 'graph neural network', limit: 10 })
if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
const items = result.value.items
```

约束：payload/value 必须 JSON（envelope 由 `clientRequestSchema` 校验，`rpc-host.ts:304-349`）；**二进制不能走这里**（没有 `Uint8Array` 编码，走第 6 节）；body 为 buffered JSON；通道路由先 `admit` 做 Host/Origin+认证，`/api` 上 exact route 只有 owner Peer 能进，403 给其他 principal（`rpc-host.ts:128-137,215-229`）。peer 身份读 `peer.principal.kind`（内置只有 `owner`）；`principalOf(this.ctx.invocation)` 仅 Typert 方法内有效（`$NM\dsh-typert-protocol\README.md:59-63`）。

## 5.3 方案 C：Typert Remote（了解即可，本阶段不建议）

Host：`extends TypertRemoteService` + `@Remote` 方法 + `static inject`；面 `./typert`、`./remote` 必须由 Typert **生成器**产出，`dsh-typert-loader` 只在包导出 `./typert` 时注册（`$NM\dsh-typert-protocol\README.md:30-53`；`$NM\dsh-typert-loader\README.md:41-53`）。Client：`await ctx.remote.$mount(contribution)` 后 `ctx.remote.<ns>.<method>()`（真实实现 `$NM\dsh-deepseek-chat-import\src\client\mount.ts:51-64`、`src\client\index.ts:3,23-25`）。本机安装里**没有** `dsh-typert-generator`（已列 `$NM`）；source-mode 回退能否让手写 `@Remote` 生效**未验证**，不要依赖。

# 6. 从 Host 提供 HTTP 字节（给面板 <img>）

## 6.1 两种 API

```ts
// (1) 认证的 API 精确路由：path 必须完整写成 /api/...，按 pathname 精确匹配
ctx.connection.fetch.register(route: {
  path: string; methods: readonly ('GET' | 'HEAD' | 'POST')[]; requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}): () => Promise<void>
// (2) 裸 HTTP 路由（无鉴权，配 ctx.connection.requestRejection 自己把关）
ctx.webServer.register(route: WebRoute | WebResourceRoute): () => void
//   WebRoute { kind: 'exact' | 'prefix', path, handler(req: IncomingMessage, res: ServerResponse) }
//   WebResourceRoute { kind, path, resource(request: Request, peer?: PeerScope) => Promise<Response> }
```

来源：`$NM\dsh-client-connection\src\rpc.ts:152-176`；`rpc-host.ts:207-251`（精确路由表、非 owner 403、404 兜底）；`$NM\dsh-host-webserver\src\index.ts:440-480` 与 `cordis_inspect_query(host/Service,'webServer')`；`$NM\dsh-host-webserver\README.md:59-69`。

## 6.2 推荐：认证 + 精确路由（MinerU 图片）

```js
import { readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'

export function registerBlobRoute(ctx, config) {
  const dispose = ctx.connection.fetch.register({
    path: '/api/zotero-seek/blob',
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    async fetch(request) {
      const name = new URL(request.url).searchParams.get('name') ?? ''
      if (!/^[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i.test(name)) return new Response('bad image name', { status: 400 })
      try {
        const bytes = await readFile(join(config.cacheDir, 'images', basename(name)))
        return new Response(bytes, { headers: {
          'content-type': /\.png$/i.test(name) ? 'image/png' : 'image/jpeg',
          'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff',
        } })
      } catch { return new Response('not found', { status: 404 }) }
    },
  })
  ctx.effect(() => dispose, 'zotero-seek: image route')
}
```

面板里直接 `<img src={`api/zotero-seek/blob?name=${encodeURIComponent(imageName)}`} alt="" />`：浏览器按 `document.baseURI` 解析相对 URL（真实浏览器半同写法 `$NM\dsh-deepseek-chat-import\src\client\upload.ts:119`），同源 `<img>` 自动带鉴权 cookie，不需要也不能手写 header。真实注册范例 `$NM\dsh-deepseek-chat-import\src\index.ts:93-96`（`ctx.connection.fetch.register({ path: UPLOAD_PATH, methods: ['POST'], requestBody: 'streaming', fetch: route })`，`UPLOAD_PATH='/api/deepseek-chat-import/archive'`：`src\protocol.ts:3-10`；处理函数返回 `Response`/NDJSON 流：`src\upload.ts:60-95`）。

## 6.3 裸 webServer 路由（仅在必须自定义方法/流时）

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix', path: '/zotero-seek-assets',
  handler: async (req, res) => {
    const rejection = ctx.connection.requestRejection(req)   // 自己做 Host/Origin + 认证
    if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('allow', 'GET, HEAD'); res.end(); return }
    const icon = await readMineruImage(req.url)              // { bytes, contentType } | null
    if (icon === null) { res.statusCode = 404; res.end(); return }
    res.statusCode = 200
    res.setHeader('content-type', icon.contentType)
    res.setHeader('cache-control', 'private, max-age=3600')
    res.end(icon.bytes)
  },
}), 'zotero-seek: assets')
```

真实范例（`requestRejection` + `setHeader('content-type')` + `res.end(bytes)`）：`$NM\dsh-host-open-in-app\src\index.ts:184-239`。注意：裸 HTTP 路由**拿不到 Peer**（`host-webserver\README.md:63`），server-wide 无鉴权（同文 132），必须自己调 `admit/requestRejection`，否则 loopback 上任何人都能读。`Content-Type` 必须自己设；图片不会被 gzip（压缩只看 media type，`host-webserver\README.md:41`）。

# 7. 长任务（MinerU 10–60 s）在 tool handler 里怎么办

结论：**直接在 `execute` 里 await，声明 `timeoutMs`，把 `exec.signal` 透传给所有 fetch 与轮询 sleep；不要为 60 s 任务上 jobs。**

- 框架对 tool body **没有硬超时**；`timeoutMs` 只是声明，强制执行者是已挂载的 `@deepseek-ai/dsh-tool-call-timeout-policy`（`$NM\dsh-tools\README.md:199`；`$NM\dsh-tool-call-timeout-policy\README.md:12,28-46`；base 挂载行 `$NM\dsh-base\cordis.patch.yml:418-419`）。它只 abort 派生 signal，等下游 settled 后把结果换成 `Error: tool call timed out after <ms>ms`（`TOOL_TIMEOUT`）；工具忽略 signal 就永远等（README:120-122）。
- 推荐 `timeoutMs: 180000`（轮询+下载留余量），内部 `maxWaitMs` 小于它；解析结果落盘后再返回（第 8 节），同一 PDF 第二次直接命中缓存。
- 用户打断（Stop）会 abort `exec.signal`；让 fetch 抛出/自己 `signal.throwIfAborted()`，框架归为 `ABORTED`（`contracts.ts:264-268`；`dsh-tools\README.md:128`）。
- running 状态由 tool card 显示即可；要实时进度需另造通道（Client 轮询 RPC 或 jobs），不是第一步必需。
- 备选（仅当「后台跑、对话继续」）：`ctx.jobs.start(spec)`（`dsh-jobs-local` 已挂载，`$NM\dsh-base\cordis.patch.yml:96-97`；`dsh-tool-jobs` 会 `attachController` 并在完成时投递 in-session 通知，`$NM\dsh-tool-jobs\src\index.ts:312-320`；契约 `$NM\dsh-jobs\README.md:28-53`；inspect：`start(spec: JobSpec): JobId`、`wait(id, timeoutMs, caller?, signal?)`）。代价：`JobSpec.kind` 属封闭 `JobKindMap`（inspect 显示现只有 `bash`），自定义 kind 是否被运行期接受**未验证**；模型还得自己 `job_output`，复杂度明显升高。

# 8. 持久化：token / 索引 / 解析缓存放哪

| 数据 | 放哪 | 做法与来源 |
|---|---|---|
| 可调参数（Zotero API 地址、MinerU 端点、超时、缓存根） | 插件 `Config`（= 行 `config`，用户 patch 持有） | 运行时改走 `configEditor`，不要自己改 `$PROFILE\cordis.patch.yml`（`configuration.md:3-12`；`practices.md:22`） |
| 秘密（MinerU token、可选 Zotero key） | `ctx.credentials` record，key `<scope>/<id>`，落在 `$HOME\.credentials.yaml` | `ctx.credentials.modifyRecord('<scope>/<id>', async current => ({ ... }))`、`readRecord`；不要放 Config（`$NM\dsh-credentials\README.md:63-70`；本机文件实测存在） |
| 解析缓存 / 索引 / 图片 | `$DSH_HOME/zotero-seek/{parsed,images,index.json}` 自建目录 | 用 `!!js dshHomePath('zotero-seek')` 给 `cacheDir` 默认值（2.1）；代码里用 `process.env.DSH_HOME ?? join(os.homedir(), '.dsh')` 兜底。优先级语义 `$NM\dsh-home-paths\README.md:31-41` |
| 需跨版本迁移的结构化状态 | 可选 `ctx.storageDomain` | 桌面 profile 已挂 storage hub/json/domain（`$NM\dsh-base\cordis.patch.yml:175-190`，root=`$DSH_HOME/storages`），但需定义 domain spec，成本高（`$NM\dsh-storage\README.md:32-46`） |

安全：不要写 `$PROFILE\package.json`、`$PROFILE\cordis.patch.yml`、`$PROFILE\node_modules`（`$SKILL\references\plugin-development.md:5`；`host-plugin.md:71-73`）；文件名白名单后再拼路径防穿越，图片路由只读 `images/`；缓存里不要存 token。

# 9. 注入系统提示词：ctx.systemPrompt.section

```ts
section(section: PromptSection): () => void
interface PromptSection {
  readonly name: string                                             // 唯一，重名抛错
  readonly order: number                                           // 升序拼接，同序按 name 的 code-unit 排序
  readonly text: string | ((context: AssembleContext) => string)   // 可返回 '' 动态隐藏
  readonly interpolate?: boolean                                   // 默认 true，false 保留字面 {{...}}
  readonly complete?: boolean                                      // 只能有一个生效的 complete
}
```

来源：`$NM\dsh-system-prompt\src\index.ts:52-76,477-494`；README 示例与 `getSectionOrder`：`$NM\dsh-system-prompt\README.md:56-66`。真实用例：`$NM\dsh-tool-jobs\src\index.ts:316-320`；带条件文本 `$NM\dsh-tool-fs\src\read.ts:69-75`。

施工建议：「引用只能来自检索结果」用独立 section，`order` 用 2500 这类业务区段（工具区 1000–2000 之后、产品区之前；顺序表 `$NM\dsh-system-prompt\src\index.ts:136-175`），名字别抢内置 `tool:*`；不要用 `system-prompt/assemble` 加工具或大段文本（`practices.md:17-18`）；`text` 可用函数按 `ctx.tools.get('zotero_search', scope)` 是否存在动态返回。

# 10. 调用内置模型：ctx.llm.stream

## 10.1 最小可用（零依赖，手动收集文本）

```js
async function askModel(ctx, prompt, signal) {
  const selection = ctx.agentDefaultModel.currentSelection()   // { provider, model, reasoningEffort? }
  let text = ''
  let finish
  for await (const chunk of ctx.llm.stream({
    provider: selection.provider, model: selection.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: 1024,
    signal,                                   // 取消入口（tool 内传 exec.signal）
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  if (finish === undefined) throw new Error('llm stream ended without finish')
  if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(`${finish.failure.code}: ${finish.failure.message}`)
  return text
}
```

依据：`stream(options: GenerateOptions): AsyncIterable<StreamChunk>` 与 `GenerateOptions` 字段（provider/model/reasoningEffort/messages/system/tools/temperature/maxTokens/stop/signal/sessionId/purpose）`$NM\dsh-llm\src\types.ts:564-606`；chunk 协议 `types.ts:488-508`；`finish` 恰好一个，失败/取消为 `{kind:'error'|'aborted', failure}`（`$NM\dsh-llm\README.md:47-57,93-95`）。`currentSelection()` 返回分离的 `{ provider, model, reasoningEffort? }`（`$NM\dsh-agent-default-model\src\index.ts:63-73`）；本机默认值由 profile patch 固定为 `deepseek-official / deepseek-flash`。

## 10.2 失败长什么样、怎么取消

- adapter 选择/分发/迭代失败不 throw，而是**终止 chunk**：`{ type:'finish', reason:{ kind:'error', failure:{ code, message, status?, … } } }`；取消是 `{ kind:'aborted', failure }`（`types.ts:496-508`；README:95）。
- 常见 code：`NO_ADAPTER`（provider 未注册）、`MISSING_CREDENTIAL`/`INVALID_CREDENTIAL`、`AUTH`、`RATE_LIMIT`、`CONTEXT_WINDOW_EXCEEDED`、`HTTP_<status>`（README:95；`$NM\dsh-llm\src\error.ts:17-73`）。按 code 分支，不要匹配 message。
- 取消：传自己的 `AbortController.signal`（tool 内用 `exec.signal`）；abort 后循环以 aborted finish 结束，也可 `signal.throwIfAborted()` 提前退出。
- 有依赖时可用 `BlockAssembler`（`new BlockAssembler(); push(chunk); blocks(); finish`），真实用法 `$NM\dsh-compaction-basic\src\summarizer.ts:144-167,196-204`；零依赖时上面手收集等价。
- DSH 不变量「model-visible ⟺ logged」：会话内请求来自 session log；插件自造辅助调用没有自动落日志，`purpose` 键需先通过 `LlmRequestPurposeMap` 声明（`types.ts:554-558`；`$NM\dsh-llm\README.md:61`）。本机自定义 purpose 的运行时行为**未验证**，保守做法是不传 `purpose`。
- `ctx.llm` 是可选服务：`inject` 写 `'llm'` 或 `ctx.get('llm')` 判空，避免无 LLM 组合崩溃（`practices.md:20`）。

# 11. 带 Host 工具 + Client UI 的插件：安装与验证

## 11.1 安装（本机 `plugin_manager` 工具已加载）

```jsonc
{ "action": "install_bundle", "target": "E:\\TheCode\\ZoteroSeek\\dsh-plugin" }
// target 也可为 npm 名/版本、git、tarball；本地目录必须是绝对路径（$NM\dsh-plugin-manager\src\install-spec.ts:61-78）
// enabled 缺省 true；approvedBuilds 仅在用户明确同意运行安装脚本时传；registry 仅在用户指定镜像时传
```

参数与语义：`$NM\dsh-plugin-manager\src\tools.ts:86-100,148-154`。返回 `ChangeResult`（`src\types.ts:170-200`）：

| 字段 | 含义 |
|---|---|
| `application` | `'applied'｜'restart-required'｜'overridden'｜'failed'｜'cancelled'`：**观测到的生效结果**，不是「pnpm 退出 0」 |
| `restartReason` | 仅 restart-required：`'no-hmr'｜'package-moved'｜'host-module'｜'unmanaged-plugin'｜'module-comparison'`（`tools.ts:44-50`） |
| `stage` / `target` / `bundle` / `version` | 最后阶段、目标、装上的包名与 manifest 版本 |
| `pendingBuilds` / `error` / `warnings` / `packageResult` | 待批准脚本、拒绝码、既有警告、pnpm 输出与日志路径 |

**新装 bundle 可通过 HMR 立即生效；替换已安装包需重启**才能换 JavaScript module generation（`$SKILL\references\host-plugin.md:71-75`；`plugin-development.md:20`）。本地目录安装=链接，Host 半通常随 HMR 重载；Client bundle 不保证自动重建（`dsh-client-modules\README.md:43,47,59-60`），手写 `client.js` 改完**刷新页面**最稳。

## 11.2 验证清单（按顺序）

1. `plugin_manager` → `list_plugins`：行存在且 enabled；bundle 详情里标题/描述/detail/icon 是 locale 值而非 fallback。
2. `application === 'applied'` 才算生效；`restart-required` 让用户重启后再验（`host-plugin.md:74-75`）。
3. `cordis_inspect_query(host/Config, listConfigs, { name: '@local/zotero-seek' })`：确认行挂载、Config 投影正常、`packageDir` 指向你的目录。
4. `cordis_inspect_query(host/Tool, listTools)`：`zotero_search` 等出现在当前 agent 可见工具里。
5. Client：`cordis_inspect_query(client/Slots, listSubTree, { root: '<你的 slot key>' })` 确认注册（本次 Client inspect 不可用，需页面连接后重试）；刷新后看面板、`<img>`、勾选引用；控制台无 `slot entry crashed`。
6. 端到端：**新会话**里让 agent 检索并注明引用，对照「检索结果集合」与答案引用，确认无编造。逐项记录未验证项（`$SKILL\references\verification.md:3-11`）；UI 变更按同文 9-11 做一次 UX 复核。

# 12. 未验证 / 风险清单（施工时优先复核）

- **Client Inspect 不可用**：本次 `cordis_inspect_query(client/*)` 超时，Client Service/Slots/Builtin 签名来自源码；页面连上后应重跑。
- **`host.call` 在 bundle 中不存在**：结论来自 runner README/源码（动态 Cordis 包专用）；bundle Client 半里若强行找 `host` 全局属未验证，按设计不存在。
- **Typert 无生成器**：本机 `$NM` 无 `dsh-typert-generator`；手写 `@Remote` 的 source-mode 回退**未验证**，不要依赖。
- **`ctx.jobs` 自定义 `JobKind`**：inspect 显示 `JobKindMap` 现仅 `bash`；运行期是否接受其他字符串未验证。
- **DSH 版本**：本机 `0.2.2-rc.3`；参考实现 dsh-zotero 1.3.0 的 `engines.dsh: >=0.2.2-rc.4 <0.3.0`（`https://raw.githubusercontent.com/VncntVx/dsh-zotero/main/package.json`）在本机会被安装期拒绝，抄它不要抄版本约束。
- **本地 bundle 的裸 import**：从 `E:\TheCode\ZoteroSeek` 解析 `@deepseek-ai/*`、`zod` 全部 `MODULE_NOT_FOUND`（本机实测）；要 import 必须在该 bundle 目录内自带 `node_modules`，且 `install_bundle` 会走 pnpm。
- **Client bundle 构建**：Host 只服务已构建的 `./client` bundle；手写 `window.__ModuleLoader__.load({ id, factory(require){…} })` 可用（`$SKILL\templates\decoration\client.js:1-22`），用 TS/JSX 编译时必须产出同一格式，否则 `dsh-client-modules` 激活期报缺少构建产物（`dsh-client-modules\README.md:59-60`）。
- **图片鉴权**：`/api` exact route 只要 owner Peer；桌面版页面 cookie 鉴权，`<img>` 同源自动带 cookie（本机 URL `http://127.0.0.1:62159`），换端口/换浏览器要重新登录。
- **6.3 裸路由**：不调 `requestRejection` 等于在 loopback 上公开文件；评审必查。
