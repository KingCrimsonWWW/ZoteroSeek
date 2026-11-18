# MinerU 云端 API 契约 —— TypeScript 实现规格

> 调研日期：2026-11-18。范围：MinerU「精准解析」v4 API（token 模式），不涉及免登录 Agent v1 API。
> 引用约定：`mparse.py` / `mineru.py` / `SKILL.md` = 本机 skill `C:\Users\kingfloyd\.agents\skills\mineru\...`；`mineru.ts` / `zip.ts` / `types.ts` = 仓库 `E:\TheCode\ZoteroSeek\src\core\...`（读取时版本）；DSH 文档 = `D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\dsh-doc\references\...`；外部链接见 §11。
> 标记：**【实测】**=skill 实测注释或本机命令验证；**【文档】**=MinerU/DSH 官方文档；**【未验证】**=推断或第三方资料。敏感信息：本文不含 token；本机 token 已过期（委托方说明），未做真实解析；`MINERU_TOKEN` 只在 Windows 用户环境变量（长度 51，进程环境没有，`mparse.py:530-551` 故 skill 回退读注册表）。

## 0. 结论速览

1. 四步：`POST /file-urls/batch` 申请上传 URL → `PUT` 原始字节（**不带 Content-Type，上传即自动提交解析**）→ `GET /extract-results/batch/{batch_id}` 轮询 → `GET full_zip_url`（无鉴权 CDN）下载 zip。
2. **最关键的契约坑**：`page_ranges` 与 `is_ocr` 属于 `files[]` 的**元素字段**，不是顶层字段。官方参数表如此（§2.1）；本机 skill 放在顶层（`mparse.py:142-153, 748`），现有 `mineru.ts:218-229` 照抄了同一错误 → 必须改，否则 `--pages` 不生效、按整篇计费。
3. 轮询终态只有 `done` / `failed`；`waiting-file`、`pending`、`running`、`converting` 都是中间态（§2.3）。推荐 2s 起、×1.5 退避、上限 20s、总超时 1800s（`mparse.py:789-815`）。
4. 分块主源用 `content_list.json`（字段可逐项核实、带 `page_idx` 与 0-1000 归一化 `bbox`）；`content_list_v2.json` 顶层按页分组，但**云端口径未实测**，只能做可选增强（§4.2-4.3）。
5. 配额：2000 页/天最高优先级、**没有查询剩余配额的接口**，只能本地台账 + 解析前熔断；token 应存 DSH credentials，不写文件不打印（§3.3、§1.2）。自己写 TS HTTP 客户端，不要 spawn 本机 Python skill：DSH 桌面运行时 Electron 44.7.0 / Node 24.21.0，自带 `fetch`（undici 7.29.1，本机实测），项目已有纯 `node:zlib` 的 `zip.ts`，零额外依赖；spawn 的坑见 §6。

## 1. 认证

### 1.1 请求头

| 请求 | Header | 说明 |
|---|---|---|
| 所有 API（申请 URL / 轮询） | `Authorization: Bearer <token>`；有 JSON body 时加 `Content-Type: application/json` | `mparse.py:571-575, 746-751`；官方文档「header 必须包含 Authorization，格式 Bearer + 空格 + Token」 |
| PUT 上传 | **不加任何 Content-Type**，也不要 Authorization | 预签名 URL 自带鉴权；官方要求上传文件时无须设置 Content-Type，第三方实测带上会 OSS `SignatureDoesNotMatch`（`mparse.py:758-761`；本机 Node 实测 `new Request(...,{body:new Uint8Array()})` 的 content-type 为 `null`，`Blob{type:''}` 也为 `null`，只有 `Blob{type:'application/pdf'}` 会带上） |
| GET `full_zip_url` | 不加 Authorization | CDN 直链（`mparse.py:770`） |

GET 轮询也不要加 `Content-Type`（`mparse.py:795-796` 用 `_headers(json_body=False)`）。

### 1.2 TS 侧 token 来源（按优先级）

1. DSH credentials（生产路径）：DSH 规定「secret 存 `ctx.credentials.modifyRecord()` 记录，不要存配置」，`inject: ['credentials']`（`configuration.md:12`）。
2. 环境变量 `MINERU_TOKEN`（兼容本机 skill / 调试）：`mparse.py:539-541`；注意 GUI 进程可能读不到 `setx` 写入的用户变量，skill 才要回退 winreg（`mparse.py:542-551`）。本机实测该变量**只在用户环境**，当前进程环境为空。
3. 插件配置里显式粘贴（最后兜底，仅当用户要求；不要持久化到文本文件）。

**硬规则**：token 不写进日志、错误消息、manifest、URL；错误对象里只保留 `api_code`、`trace_id`。`full_zip_url` 带签名，日志只截断展示 host。

### 1.3 鉴权错误码与零成本探针

| code | 官方含义 | 处理 |
|---|---|---|
| `A0202` | Token 错误 / 缺 Bearer 前缀 | 不重试，提示重新填 token |
| `A0211` | Token 过期 | 不重试，提示刷新 token（本机当前即此状态） |

零成本鉴权探针：`GET /extract-results/batch/00000000-0000-0000-0000-000000000000`，返回 `code == -60012`（task not found）即证明 token 有效且**不消耗任何页数**；`A0202/A0211` 即鉴权失败（`mparse.py:904-926`，`mineru.py:124-134` 的 `doctor`）。实现为插件设置页的「测试连接」按钮。

## 2. 四步 HTTP 契约

基地址 `https://mineru.net/api/v4`（`mparse.py:59`）。统一响应包装（官方文档）：

```json
{ "code": 0, "msg": "ok", "trace_id": "…", "data": { } }
```

`code === 0` 才是成功（可能是数字 0 或字符串 `"0"`，判断两种）；非 0 按 §7 映射。

### 2.1 Step 1：申请上传 URL

`POST /file-urls/batch`，`Authorization` + `Content-Type: application/json`。

**请求体字段**（官方请求体参数表；本机 skill 的实测流量见 `mparse.py:9-14`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model_version` | string | 否 | `pipeline`（服务端默认）/ `vlm`（推荐，本项目默认）/ `MinerU-HTML`（仅 html） |
| `language` | string | 否 | 默认 `ch`（不是 `zh`）；中英混排文献仍用 `ch`（`SKILL.md:113`） |
| `enable_formula` | bool | 否 | 默认 true |
| `enable_table` | bool | 否 | 默认 true |
| `files[].name` | string | **是** | 文件名，必须带正确后缀（服务端按后缀判类型，否则 `-60002`） |
| `files[].data_id` | string | 否 | 业务标识，≤128，字符集 `[A-Za-z0-9_.-]`；会原样回显在轮询结果里 → 用来关联 Zotero key |
| `files[].is_ocr` | bool | 否 | **文件级**；扫描件才开 |
| `files[].page_ranges` | string | 否 | **文件级**；`"1-600"`、`"2,4-6"`、`"2--2"`（倒数第二页） |
| `callback`/`seed`/`extra_formats` | string/string[] | 否 | 回调签名与额外导出（docx/html/latex）；本项目都不用，改轮询 |

**响应**：

```json
{ "code": 0, "msg": "ok", "trace_id": "…",
  "data": { "batch_id": "2bb2f0ec-…", "file_urls": ["https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/…"] } }
```

约束：单请求 ≤200 个文件；单文件 ≤200MB、≤600 页；上传 URL 24 小时有效；**上传完成即自动提交解析，没有单独的 submit 接口**（官方文档；`mparse.py:9-17`）。

可照抄的 TS 类型与构造：

```ts
export const MINERU_BASE = 'https://mineru.net/api/v4'
export type MineruState = 'waiting-file' | 'pending' | 'running' | 'converting' | 'done' | 'failed'
export interface ParseProfile {
  modelVersion: 'vlm' | 'pipeline'; language: string
  enableFormula: boolean; enableTable: boolean
  isOcr: boolean; pageRanges?: string
}
export interface UploadFile { name: string; dataId?: string; isOcr?: boolean; pageRanges?: string }

function batchBody(files: UploadFile[], p: ParseProfile): Record<string, unknown> {
  return {
    model_version: p.modelVersion,
    language: p.language,
    enable_formula: p.enableFormula,
    enable_table: p.enableTable,
    files: files.map((f) => ({
      name: f.name,                       // 必须带 .pdf 后缀
      data_id: f.dataId,
      is_ocr: f.isOcr === true ? true : undefined,
      page_ranges: f.pageRanges,          // ★ 放元素里，不是顶层
    })),
  }
}
```

### 2.2 Step 2：PUT 上传原始字节

```ts
async function uploadPdf(uploadUrl: string, bytes: Uint8Array): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: bytes,                            // Uint8Array：undici 不会自动加 Content-Type（本机实测）
    signal: AbortSignal.timeout(600_000),   // 200MB 上传别用 60s
  })
  if (res.status !== 200 && res.status !== 201) {
    throw new MineruError('service_unavailable', `上传返回 HTTP ${res.status}`, { retryable: true })
  }
}
```

- 成功 200/201（`mparse.py:762`）。大文件可 `body: await fs.openAsBlob(pdfPath)`（Node 24 可用；`openAsBlob` 默认 `type:''`，实测 Request 不会带 Content-Type）。
- 不要手工设置 `Content-Length`/`Content-Type` 之外的头；skill 只加了 Content-Length（`mparse.py:760-761`），Node fetch 会自己算。
- 上传失败（4xx/5xx）→ `service_unavailable`/`network`，可重试；但重试前先重新走 Step 1 拿新 URL（URL 可能过期）。

### 2.3 Step 3：轮询批次结果

`GET /extract-results/batch/{batch_id}`，带 `Authorization`，无 body、无 Content-Type。

**响应**（官方批量结果参数表）：

```json
{ "code": 0, "msg": "ok", "trace_id": "…",
  "data": { "batch_id": "2bb2f0ec-…",
    "extract_result": [
      { "file_name": "demo.pdf", "data_id": "ABCD1234", "state": "done",
        "err_msg": "", "full_zip_url": "https://cdn-mineru.openxlab.org.cn/pdf/….zip" },
      { "file_name": "b.pdf", "state": "running", "err_msg": "",
        "extract_progress": { "extracted_pages": 1, "total_pages": 2, "start_time": "2025-01-20 11:43:20" } } ] } }
```

| 字段 | 说明 |
|---|---|
| `extract_result[]` | 与上传文件一一对应；按 `data_id` 或 `file_name` 认领自己的条目 |
| `.state` | 状态机，见下表 |
| `.full_zip_url` | `done` 时才有；缺失视为服务端不一致（重试一次再报 `parse_failed`） |
| `.err_msg` | `failed` 时的失败原因（直接进用户文案） |
| `.extract_progress` | `running` 时有；可用于侧边栏进度条（已解析页/总页） |
| `.data_id` | 回显 Step 1 的 `data_id` |

**状态枚举**（官方：`done`/`pending`/`running`/`failed`/`converting`；批量结果另有 `waiting-file`）：

| state | 含义 | 处理 |
|---|---|---|
| `waiting-file` | 等待文件上传完成、排队提交解析 | 继续轮询；若 >120s 仍是它 → 文件没上传成功，报 `parse_failed` 并提示重传 |
| `pending` | 排队中 | 继续轮询 |
| `running` | 解析中 | 继续轮询（可读 `extract_progress`） |
| `converting` | 额外格式转换中（`extra_formats`） | 继续轮询 |
| `done` | 完成，取 `full_zip_url` | 终态成功 |
| `failed` | 失败，取 `err_msg` | 终态失败 |

可照抄：

```ts
interface BatchResultItem {
  file_name?: string; data_id?: string; state: MineruState
  full_zip_url?: string; err_msg?: string
  extract_progress?: { extracted_pages?: number; total_pages?: number; start_time?: string }
}

async function pollBatch(batchId: string, opts: {
  token: string; baseUrl?: string; signal?: AbortSignal
  initialMs?: number; capMs?: number; maxWaitMs?: number
  onProgress?: (done: number, total: number) => void
}): Promise<string> {
  const base = (opts.baseUrl ?? MINERU_BASE).replace(/\/+$/, '')
  const initial = opts.initialMs ?? 2_000, cap = opts.capMs ?? 20_000, maxWait = opts.maxWaitMs ?? 1_800_000
  const started = Date.now()
  let delay = initial, empty = 0
  for (;;) {
    const res = await fetch(`${base}/extract-results/batch/${encodeURIComponent(batchId)}`, {
      headers: { Authorization: `Bearer ${opts.token}` }, signal: opts.signal,
    })
    const payload = await res.json() as { code: number | string; msg?: string; data?: { extract_result?: BatchResultItem[] } }
    if (String(payload.code) !== '0') throw apiError(payload.code, payload.msg)   // §7
    const item = payload.data?.extract_result?.[0]
    if (item === undefined) {                       // 刚上传时可能短暂为空：重试若干次再判失败
      if (++empty >= 5) throw new MineruError('parse_failed', '轮询结果为空（extract_result 缺失）')
    } else {
      empty = 0
      if (item.state === 'done') {
        if (!item.full_zip_url) throw new MineruError('parse_failed', 'done 但没有 full_zip_url')
        return item.full_zip_url
      }
      if (item.state === 'failed') throw new MineruError('parse_failed', `解析失败：${item.err_msg ?? '未知原因'}`)
      const p = item.extract_progress
      if (p?.total_pages) opts.onProgress?.(p.extracted_pages ?? 0, p.total_pages)
    }
    if (Date.now() - started > maxWait) throw new MineruError('service_unavailable', '等待解析超时', { retryable: true })
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(Math.round(delay * 1.5), cap)
  }
}
```

### 2.4 Step 4：下载结果 zip

`GET full_zip_url`：**不带 Authorization**、无 Content-Type；200 返回 zip 字节（`mparse.py:770-774`）。超时给 600s；失败可重试 2 次（CDN 偶尔 5xx）。zip 解析用仓库已有的 `zip.ts`（`unzip(Uint8Array): Map<string, Uint8Array>`，只支持 store/deflate、非 ZIP64，`zip.ts:28-88`）——MinerU 产物是否永远是这三者**【未验证】**，首次实测时若抛 `ZipError('unsupported')` 再考虑 fflate。

### 2.5 统一 HTTP 错误处理（`mparse.py:776-787`）

```ts
export type MineruErrorKind = 'config'|'auth'|'quota'|'rate_limited'|'service_unavailable'|'network'|'parse_failed'|'unsupported_format'|'file_rejected'|'param_error'|'not_found'
export class MineruError extends Error {
  readonly kind: MineruErrorKind; readonly retryable: boolean; readonly apiCode?: string; readonly resumeAfter?: string
  constructor(kind: MineruErrorKind, message: string, o: { retryable?: boolean; apiCode?: string; resumeAfter?: string } = {}) {
    super(message); this.name = 'MineruError'; this.kind = kind
    this.retryable = o.retryable ?? false; this.apiCode = o.apiCode; this.resumeAfter = o.resumeAfter
  }
}
declare function apiError(code: number | string, msg?: string): MineruError   // 按 §7 表映射，实现见 §9 第 2 条

async function apiJson<T>(url: string, init: RequestInit & { timeoutMs: number }): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs) })
  if (res.status === 429) throw new MineruError('rate_limited', '触发限流（HTTP 429）', { retryable: true })
  if (res.status >= 500) throw new MineruError('service_unavailable', `服务端错误 HTTP ${res.status}`, { retryable: true })
  const text = await res.text()
  let payload: { code: number | string; msg?: string; data?: T }
  try { payload = JSON.parse(text) } catch { throw new MineruError('service_unavailable', `非 JSON 响应：${text.slice(0, 200)}`, { retryable: true }) }
  if (String(payload.code) !== '0') throw apiError(payload.code, payload.msg)
  return (payload.data ?? {}) as T
}
```

## 3. 轮询、限流、配额

### 3.1 推荐参数

| 参数 | 推荐值 | 依据 |
|---|---|---|
| 首次轮询延迟 | 2s | `mparse.py:789` |
| 退避倍率 / 上限 | ×1.5 / 20s | `mparse.py:814-815` |
| 单次轮询总超时 | 1800s（30min），可配置 | `mparse.py:790`；现有 `mineru.ts:124` 的 600s 偏短（300 页 VLM 可能更久） |
| HTTP 超时 | API 60s；上传/下载 600s | `mparse.py:556`（60s）+ 上传/下载显式 600s |
| 可重试错误退避 | 20s，最多 3 次 | `mparse.py:730-731` 对 `retryable` 睡 20s |

### 3.2 限流与重试（官方 limit 页）

- **提交类接口**（`/file-urls/batch`、`/extract/task`、`/extract/task/batch`）共用 **300 请求/分钟**；**取结果类**共用 **1000 请求/分钟**；每用户 **10000 文件/天**，其中 HTML ≤100 个/天。超限会被系统拒绝。
- HTTP **429** → `rate_limited`（可重试）；`-60009`「任务提交队列已满」→ 也按 `rate_limited` 退避（`mparse.py:74`）。有 `Retry-After` 就按它，没有就 20s 起指数退避。
- `-10002` 官方含义是「请求参数错误」，**不是限流**：本机 skill 映射成 `rate_limited`（`mparse.py:86`）是错的，别照抄；参数错误重试无用。
- **并发**：官方只给 QPS，没给并行任务数上限（**【未验证】**）。建议全局并发 ≤3 个解析任务、轮询 ≤1 次/秒/任务；ZoteroSeek 一次只解析一篇时天然安全。

### 3.3 配额事实与台账

- **2000 页/天为最高优先级额度，超出部分降为低优先级**（官方原句：「Each account has a daily quota of 2,000 pages with highest priority; pages beyond 2,000 will have lower priority」）——文档语义是降级而非硬拒绝；同时存在硬错误 `-60018`「每日解析任务数量已达上限」、`-60019`「HTML 解析额度不足」（官方错误码表）。**没有查询剩余配额的端点**（`SKILL.md:83-86`、`mparse.py:30-34`）→ 只能本地台账，并明确告诉用户「这是本地记录，不是服务端权威值」。
- 计费口径：一篇 PDF 的页数，或 `page_ranges` 切片的页数（`mparse.py:737-744`；`SKILL.md:112`）。**重新上传同一文件仍会再计费**（上传路径没有服务端去重；只有 URL 解析有 `no_cache`/`cache_tolerance` 缓存，官方文档）→ 本地缓存是唯一防线。
- 重置时间：**北京时间 00:00**（UTC+8，无夏令时）（`SKILL.md:82-86`）。`todayInBeijing()` 实现可沿用 `mineru.ts:478-481`。

台账（建议 `dataDir/mineru-ledger.json`）：

```ts
interface Ledger { days: Record<string, { pages: number; files: number }> }
const BEIJING_OFFSET_MS = 8 * 3600_000
export function beijingDay(now = Date.now()): string {
  return new Date(now + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}
export function nextBeijingMidnightIso(now = Date.now()): string {
  const dayStart = Math.floor((now + BEIJING_OFFSET_MS) / 86_400_000) * 86_400_000
  return new Date(dayStart + 86_400_000 - BEIJING_OFFSET_MS).toISOString()
}
```

**解析前必须预检熔断**：`todayPages() + estimatePages > maxPagesPerDay`（默认 2000，可调）→ 直接抛 `quota`，文案带 `nextBeijingMidnightIso()`；成功解析后才记账；解析失败/取消不记。90% 时在 UI 提醒。

## 4. 下载产物与分块数据

### 4.1 zip 内文件（实测 + 官方对照）

服务端给所有 JSON 加 `<uuid>_` 前缀，**必须 glob，不能硬编码文件名**（`mparse.py:19-28, 817-850`；`SKILL.md:107`）。服务端观察到的清单（`mparse.py` 顶部依据 2026-09-20 真实流量实测；官方只承诺 `full.md`/`layout.json`/`*_content_list.json`，v2 与 origin.pdf 是云端额外产物）与规范名映射：

| zip 条目（glob） | 落盘名 | 用途 |
|---|---|---|
| `full.md`（精确名） | `full.md` | 阅读/引用正文；图片以 `![](images/xxx.jpg)` 相对引用；表格是 HTML、公式是 `$…$`/`$$…$$`（`SKILL.md:144-150`） |
| `*_content_list.json`（排除 v2） | `content_list.json` | **分块主源**：阅读顺序扁平块，带 `page_idx` 与 0-1000 归一化 `bbox` |
| `*_content_list_v2.json` | `content_list_v2.json` | 按页分组的块（云端口径**【未验证】**，见 §4.3） |
| `layout.json`（精确名） | `layout.json` | 版面中间格式 = 官方文档里的 `middle.json`：`pdf_info[].page_idx/page_size/para_blocks`，bbox 为原始 pt；顶层 `_backend`、`_version_name` 是唯一可读的后端/版本来源（`mparse.py:879-887`） |
| `*_model.json` | `model.json` | 原始模型检测框（云端口径时有时无；可选） |
| `*_origin.pdf` | `origin.pdf` | 实际被解析的 PDF（若用了 `page_ranges` 这是切片）；侧边栏 PDF 预览/高亮备用 |
| `images/*` | `images/*` | 图片，按内容哈希命名（如 `a8ecda…jpg`）；`full.md` 用它相对引用 |
| 其它 | `extras/*` | 兜底保存，便于排查 |

（官方 `full_zip_url` 说明只承诺 `full.md`、`layout.json`、`*_content_list.json`、`*_model.json`；解压实现按“可选文件”处理，不要因缺失而失败。）

### 4.2 `content_list.json`（v1）字段级说明【文档+云端可验证】

JSON 数组，按阅读顺序。所有块都有 `page_idx`（0 起）与 `bbox`（`[x0,y0,x1,y1]`，页面宽高映射到 0-1000，官方 output_files 文档）。

| type | 字段 | 说明 |
|---|---|---|
| `text` | `text`, `text_level?` | **正文没有 `text_level` 字段（不是 0/null）**；`1`=一级标题、`2`=二级…（官方文档；2026-03 云端实测同结论） |
| `table` | `img_path`, `table_body`, `table_caption[]`, `table_footnote[]` | `table_body` 是 HTML；云端实测 `<table>` 直接开头，无 `<html><body>` 外层（第三方实测）→ 解析要容错 |
| `equation` | `text`, `text_format:"latex"`, `img_path` | `text` 自带 `$$…$$`；简单公式可能被内联进 `text` 块而**没有独立 equation 块**（第三方云端实测） |
| `image` | `img_path`, `image_caption[]`, `image_footnote[]` | 图注是数组，可能为空 |
| `code` / `list` | `code`: `sub_type:"code"\|"algorithm"` + `code_body` + `code_caption[]` + `code_footnote[]`；`list`: `sub_type:"text"\|"ref_text"` + `list_items[]` | VLM 后端新增；`ref_text` 是参考文献列表 |
| `header`/`footer`/`page_number`/`aside_text`/`page_footnote` | `text`（多数） | VLM 的 discarded_blocks 也会输出，**分块时应过滤** |

示例（字段名逐字来自官方 output_files 文档；省略号是省略内容）：

```json
[
  { "type": "text", "text": "1 Introduction", "text_level": 1, "bbox": [131, 200, 317, 222], "page_idx": 0 },
  { "type": "table", "img_path": "images/<sha256>.jpg", "table_caption": ["Table 2 …"], "table_footnote": [],
    "table_body": "<table><tr><td>…</td></tr></table>", "bbox": [62, 480, 946, 904], "page_idx": 5 },
  { "type": "equation", "img_path": "images/<sha256>.jpg", "text": "$$\nQ _ { \\% } = f ( P ) + g ( T )\n$$",
    "text_format": "latex", "bbox": [62, 480, 946, 904], "page_idx": 2 },
  { "type": "image", "img_path": "images/<sha256>.jpg", "image_caption": ["Fig. 1 …"], "image_footnote": [],
    "bbox": [62, 480, 946, 904], "page_idx": 1 }
]
```

### 4.3 `content_list_v2.json`：结构已知、云端口径未验证

官方 3.0 输出文档（`output_files.md`，见 §11）明确：**顶层是按页分组的列表（`list[list[dict]]`）**；每个块是统一的 `type + content` 结构：

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | `title` / `paragraph` / `equation_interline` / `image` / `table` / `chart` / `seal` / `code` / `algorithm` / `list` / `index` / `page_header` / `page_footer` / `page_number` / `page_aside_text` / `page_footnote` |
| `content` | dict | 按 type 不同：`title`→`{title_content:[{type:"text",content:"…"}],level}`；`paragraph`→`{paragraph_content:[…]}`；`equation_interline`→`{math_content,math_type}`；视觉类→图片路径/图注等；`code`→`{code_content,code_caption,code_footnote,code_language}` |
| `bbox` | `list[int]` | 可选，0-1000 |
| `anchor` / `sub_type` | string | 可选；`anchor` 仅部分 DOCX 标题/索引项；`sub_type` 是 image/chart 的视觉子类型 |

```json
[
  [ { "type": "title", "content": { "title_content": [ { "type": "text", "content": "1 Introduction" } ], "level": 1 },
      "bbox": [83, 121, 917, 156] },
    { "type": "page_footnote", "content": { "page_footnote_content": [ { "type": "text", "content": "* Corresponding author" } ] },
      "bbox": [71, 815, 915, 841] } ]
]
```

**风险**：本机 skill 只证明云端 zip **有**这个文件、且“按页分组”（`mparse.py:22`），没有证明云端块字段就是 3.0 文档里的 `type+content`（云端 3 月实测文档里还没有 v2；3.0 之后才加）。因此 TS 实现策略：

1. 分块主路径用 `content_list.json`（v1，字段风险最低）；
2. v2 作为**可选增强**：顶层数组、每个元素是“页数组”→ 页号 = `元素下标 + 1`；块文本优先按 `content` 的 `*_content` 数组拼 `content[].content`，视觉类跳过；遇到未知结构直接降级回 v1，不抛错；
3. 首篇真实解析后把 v2 样本（脱敏）落进仓库 fixture，再决定是否切换主路径。

### 4.4 分块映射（给 `chunker.ts` / `types.ts` 的规则）

- `page = page_idx + 1`（UI 1 起）；若解析用了 `page_ranges`，`page_idx` 是**切片内相对页**，需要把 `"2,4-6"` 解析成绝对页映射；**正式入库不要传 `page_ranges`**（只在省钱测试时用），否则引用页号会错。
- `sectionPath`：按阅读顺序维护标题栈，`text_level=1..6` 入栈/出栈；`text_level` 缺失即正文；非 `text` 的标题类（v2 的 `title`）同样入栈。
- 过滤 `header`/`footer`/`page_number`/`aside_text`/`page_footnote` 等辅助块（`content_list` 里它们会作为独立 type 出现）。
- 表格：`table_caption` 作章节/标题上下文，`table_body` HTML→Markdown 表格（或保留 HTML 给渲染），整表一个 chunk，`kind:'table'`。
- 公式：`equation.text` 原样保留（LaTeX），单独 chunk 或贴到相邻正文；`kind:'equation'`。
- 图：`image_caption` 文本入 chunk，`imagePath = img_path`（相对解析目录）；`kind:'figure'`。
- 每个 chunk 带 `itemKey`、`page`、`kind`、`sectionPath`，与 `types.ts:56-71` 的 `Chunk` 对齐；`ContentBlock`（`types.ts:43-53`）作为中间归一化结构，v1/v2 都先归一到它。

### 4.5 引用高亮（右侧栏用）

- `content_list.json` 的 `bbox` 是 0-1000 归一化（官方）；`layout.json` 的 `bbox` 是原始 PDF pt，且页有 `page_size:[w,h]`（官方 output_files 文档）→ 两者换算：`pt = bbox/1000 * page_size`。
- 侧边栏预览若用 `origin.pdf`：页号直接用 `page_idx`；若用 Zotero 原 PDF 且解析未切片，两者页序一致。高亮框用 `bbox` 即可，不必依赖 `layout.json`。
- `images/*` 相对 `full.md` 的路径是 `<解析目录>/images/<sha>.jpg`，Host 侧做静态资源路由时按解析目录为根（`mineru.ts:449-457` 已有 `listImages`）。

## 5. 缓存与幂等

### 5.1 两个指纹

```ts
import { createHash } from 'node:crypto'
const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex')
const fp = (sourceSha1: string, p: ParseProfile) => JSON.stringify({ sourceSha1, ...p, pageRanges: p.pageRanges ?? null })
const dirName = sha1(new TextEncoder().encode(fp(sourceSha1, profile))).slice(0, 16)
```

- 内容寻址：key 用 **PDF 字节 sha1**，不是路径/文件名（`SKILL.md:95-97`）；同一 PDF 换 Zotero 条目、改名、移动目录都命中同一条缓存。
- 参数参与身份：`backend/language/ocr/pages`（本项目再加 `enableFormula/enableTable`）任一变化 → **新 run，不是重解析旧 run**（`SKILL.md:99-101`）。现有 `mineru.ts:207-216` 的 `settingsFingerprint` 已包含这些字段，可直接沿用。
- 反向提醒：本机 skill 的 `find_by_sha1` **只按 sha1 找、忽略 profile**（`mparse.py:622-631` vs `mparse.py:473-483`），与 SKILL 文档自相矛盾 —— 我们不要复刻这个行为，profile 必须进 key。

### 5.2 目录布局（建议沿用 `mineru.ts` 现有方案并补齐）

```
<dataDir>/                              # DSH host 决定；建议 dshHomePath('zotero-seek') 下（composition-reference.md:17；本机 DSH_HOME=C:\Users\kingfloyd\.dsh），不要写进仓库工作区
  mineru-manifest.json                  # fingerprint → { dirName, itemKey, parsedAt, pageCount, backend, version }
  mineru-ledger.json                    # 'YYYY-MM-DD'(北京时间) → { pages, files }
  parsed/<dirName>/                     # dirName = sha1(fp(...)).slice(0,16)
    meta.json                           # itemKey, sourceSha1, fingerprint, backend, language, pageRanges, pageCount, parsedAt
    full.md
    content_list.json
    content_list_v2.json                # 可选
    layout.json
    model.json                          # 可选
    origin.pdf                          # 可选（page_ranges 时是切片）
    images/*.jpg
```

### 5.3 完成判定与原子写

- 完成 = `full.md` + `meta.json` + **至少一个 content_list**（v1 或 v2）都存在且 `full.md` 非空；缺一项就当未完成重做（`SKILL.md:76-78`、`mparse.py:421-431`；现有 `mineru.ts:355-374` 只查 full.md+meta，建议补 content_list）。
- 先写 `<dir>.tmp-*`，全部成功后再 `rename` 到正式目录；失败清 staging。顺序：解压 → meta → rename → manifest → ledger（`mparse.py:654-691`）。
- 并发解析同一 itemKey 时加进程内串行队列（manifest/ledger 是整文件写，读-改-写会丢更新）。

### 5.4 什么会产生新解析（成本影响）

| 变化 | 是否重新花钱 |
|---|---|
| PDF 字节变化（重新导出、压缩、替换附件） | 是（sha1 变） |
| 同一 PDF 换文件名/目录/Zotero 条目 | 否（sha1 相同） |
| `model_version` / `language` / `is_ocr` / `page_ranges` / `enable_formula` / `enable_table` 变化 | 是（profile 变 = 新 run） |
| Zotero 元数据（标题/作者/年份/标签）变化 | 否（只更新 meta/manifest，不重解析） |
| MinerU 服务端升级版本 | 不会自动重解析；`layout.json._version_name` 记录当时版本，需要更好结果时手动 `force` |

## 6. 自己写 TS 客户端 vs 调本机 Python skill

**结论：自己写 TS 客户端（推荐）。** 现有 `mineru.ts` 方向正确，按 §9 修正即可。

| 维度 | 自写 TS（Node fetch + `zip.ts`） | spawn `mineru.py` |
|---|---|---|
| 运行时依赖 | 零额外依赖：DSH 桌面 = Electron 44.7.0 / Node 24.21.0，`fetch` 为 function、undici 7.29.1（本机 `ELECTRON_RUN_AS_NODE` 实测）；zip 已有 `node:zlib` 实现 | 依赖本机 python + `requests` + skill 路径存在 |
| 可打包/可移植 | 是，随插件走 | 否：skill 在 `C:\Users\kingfloyd\.agents\skills\mineru`（用户级、会升级/改名，旁边已有 `skills.bak-*`） |
| 错误/进度/编码 | 稳定 kind + trace_id，可直接做 UI | 只能 parse stdout（`--verbose` 是文本）；本机 `python mineru.py --help` 的 stdout 捕获为乱码，`mparse.py:210-226` 还注释了 Windows ANSI/UTF-8 解码坑 |
| token 传递 | DSH credentials 直接读，不落进程环境 | 需注入 env；本机 `MINERU_TOKEN` 只在用户注册表，子进程未必继承（`mparse.py:542-551`） |
| 缓存/台账 | 与插件共用一套 manifest/ledger | skill 自己写 `_manifest.jsonl` + `_ledger.json`，两套状态会漂移 |
| 取消/超时 | `AbortSignal` 可控 | 要杀子进程树；Windows 上易留孤儿子进程 |
| DSH 集成 | host 插件内直接调用 | 需 DSH subprocess seam（`@deepseek-ai/dsh-subprocess` 抽象 + `dsh-subprocess-local`，`packages.md:477-481`），多一层配置，且仍受上面所有限制 |

若将来确实要复用 skill（例如临时对照校验），底线：通过 DSH subprocess seam 启动、显式传 `env: { MINERU_TOKEN }`、`cwd` 固定、要求 `--offline` 或只跑 `doctor`、只解析 JSON/退出码，不解析自然语言 stdout。

## 7. 失败分类与用户可见文案

统一 `MineruError { kind, retryable, apiCode?, resumeAfter? }`，`trace_id` 从响应包装单独记录；UI/Tool 只按 `kind` 分支（`SKILL.md:130-143`、`mparse.py:62-87`）。映射建议：

| kind | 触发 | 用户可见文案（建议） | 自动重试 | 备注 |
|---|---|---|---|---|
| `config` | 无 token / 空 token | 还没配置 MinerU Token。请在插件设置里填入（mineru.net 用户中心 → API 管理）。 | 否 | 入口处直接拦截，不发请求 |
| `auth` | `A0202`、`A0211`、HTTP 401/403 | MinerU Token 无效或已过期，请重新生成后填回插件设置。 | 否 | 本机当前就是 `A0211`（委托方说明） |
| `quota` | `-60018`、`-60019`、本地台账熔断 | 今日 MinerU 解析额度已用完（北京时间 0 点重置），可在设置里调低单日上限或明天再试。 | 否 | 带 `resumeAfter` ISO 时间 |
| `rate_limited` | HTTP 429、`-60009` | MinerU 当前繁忙（限流），已自动等待重试。 | 是（≤3 次，20s 起） | 尊重 `Retry-After` |
| `service_unavailable` | HTTP 5xx、`-60007`、`-10001`、`-60001`、轮询超时、非 JSON | MinerU 服务暂时不可用，请稍后重试。 | 是（≤3 次） | 保留 `trace_id` 供反馈 |
| `network` | fetch 抛错、DNS/代理失败 | 连不上 MinerU，检查网络/代理后重试。 | 是 | DSH 有 `dsh-http-proxy` 包，注意代理配置 |
| `parse_failed` | `state=failed`、`-60010`、`-60015`、`-60016`、`-60017`、`-60012`(非探针场景)、缺 `full_zip_url` | 这篇 PDF 解析失败了：<err_msg>。可尝试改用 pipeline 后端或先把文件转成 PDF。 | 视 code；一般否 | 原样带 `err_msg`，别吞 |
| `unsupported_format` | `-60002`、非 PDF 输入 | 只支持 PDF（docx/doc/ppt 请先转换）。 | 否 | 本地先按扩展名拦一次 |
| `file_rejected` | `-60003`~`-60006`、`-60008`、`-60011`、`-60013`、`-60014` | 文件不符合 MinerU 要求（损坏/空文件/超过 200MB/超过 600 页/未上传成功）。 | 否（`-60008` 可一次） | `-60005/-60006` 建议单独文案：文件太大/页数超 600 |
| `not_found` | `-60012` | 内部：任务不存在（探针用）。 | 否 | 只用于 doctor |
| `param_error` | `-500`、`-10002` | 插件请求参数有误（版本不匹配），请更新插件或反馈日志。 | 否 | 别映射成 429 |

每次都记录：`kind`、`api_code`、`trace_id`、`batch_id`、文件名、页数；**不记录 token、完整 `full_zip_url`**。

## 8. 省钱测试法（当前 token 已过期，先换 token）

1. **先跑零成本鉴权**：GET 不存在的 batch → `-60012` = token 有效，0 页消耗（`mparse.py:904-926`）。`A0211` 就先换 token，别急着上传。
2. **单页链路测试**：选一个 ≥3 页的 PDF，`files[0].page_ranges = "1-1"`，只解析第 1 页 → 计费 1 页（占日额度 1/2000）。确认 `full.md` 只含第 1 页内容、`content_list.json` 的 `page_idx` 全为 0、台账 +1。（依据：`SKILL.md:112`「`--pages 1-3` 按 3 页计费，且结果只有这些页」；计费口径 `mparse.py:737-744`。）
3. **注意 1 页 PDF 无省钱效果**（本来就 1 页）；且 `page_ranges` 若放顶层（本机 skill/现有代码写法）可能被服务端忽略 → 整篇解析、整篇计费；测试前按 §2.1 改到 `files[]` 并在结果里核对页数。
4. 上传成功即开始解析，**没有“先试算再提交”接口**；测试用例挑已缓存的 PDF 或在缓存目录里重跑（命中 sha1 则 0 成本）。
5. 下载 zip 后保留产物，后续所有 zip 解析/分块 work 都离线做（`--offline` 等价物 = 本地缓存命中），不再花钱。

## 9. 与现有 `src/core/mineru.ts` 的差异（施工必改清单）

> 以 2026-11-18 22:20 左右读取的版本为准；文件可能仍被其他 agent 修改，改前重读。

1. **`requestBody`（`mineru.ts:218-229`）**：`page_ranges`、`is_ocr` 移到 `files[0]` 内；顶层只留 `model_version/language/enable_formula/enable_table`。（§2.1）
2. **`ERROR_CODES`（`mineru.ts:34-53`）**：按 §7 表重排——`-60007/-10001` → `service_unavailable` 可重试；`-60009` → `rate_limited`；`-60012` → `not_found`；`-10002/-500` → `param_error` 不可重试；`-60005/-60006` 单独 `file_rejected` 文案；补 `-60019`。当前把 `-60009` 当 `parse_failed` 不可重试是错的。
3. **上传/下载超时（`mineru.ts:249, 293`）**：60s 改 600s；上传可改用 `fs.openAsBlob` 流式（默认 `type:''`，实测不带 Content-Type）。
4. **轮询（`mineru.ts:124, 264-266`）**：总超时 600s→1800s（可配置）；刚上传时 `extract_result` 短暂为空正常，连续 5 次为空再判失败（§2.3）。
5. **缺解析前配额熔断（`mineru.ts:139-169`）**：先 `todayPages() + estimate >= maxPagesPerDay` 判断，超了直接抛 `quota`；成功后才记账。
6. **`estimatePdfPages`（`mineru.ts:469-475`）**：正则 `/Type\s*\/Page[^s]/` 在压缩对象流（xref stream）PDF 上可能数出 0 或偏多；建议数不出来时记 `pageCount=null` 并把服务端 `extract_progress.total_pages` 回填台账，不要静默记 0 页。
7. **完成判定（`mineru.ts:355-374`）**：补 `content_list.json` 或 `content_list_v2.json` 必须存在，否则一个缺 JSON 的 zip 会被当成命中，分块直接空。
8. **上传文件名与 `data_id`（`mineru.ts:155, 220`）**：`basename(pdfPath)` 可能没有 `.pdf` 后缀（Zotero 附件名不可控）→ 服务端 `-60002`，命名兜底 `<itemKey>.pdf`；`data_id` 用 Zotero key（字符集合法），`replace` 后为空则 `String(itemKey).slice(0,128)`，轮询时用它认领条目。
9. **manifest/ledger 并发写（`mineru.ts:429-447`）**：整文件读改写，批量/并发解析会丢记录；加串行队列或按目录分片。
10. **缺 doctor/测试连接**：补 §1.3 探针（设置页按钮），返回「token 有效/过期/网络不可达」。
11. **`origin.pdf` 被丢弃（`mineru.ts:329`）**：正式解析保留 Zotero PDF 没问题；若为引用高亮用 `origin.pdf`，`page_ranges` 切片会导致页号错位——正式解析不传 `page_ranges`，测试解析在 meta 里标 `sliceOf`。

## 10. 未验证项（实测前不要写进用户承诺）

- 云端 `content_list_v2.json` 的块字段是否就是 MinerU 3.0 文档的 `type+content`（§4.3）；解析一篇后会知道。
- `page_ranges` 放顶层是否被服务端静默忽略（官方参数表只有 `files[].page_ranges`；skill 顶层写法未实测过省钱效果）。
- ZIP 是否始终为 store/deflate、非 ZIP64（现有 `zip.ts` 的子集假设）。
- `extract_progress.total_pages` 在 `page_ranges` 切片下报的是切片页还是原文档页。
- 每账号并行解析任务数上限、`Retry-After` 是否返回（官方只给 QPS，未给并发数和该头）。
- `-60018` 到底按“任务数”还是“页数”限制（官方原文「每日解析任务数量」）。

## 11. 来源

本机文件（绝对路径）：

- `C:\Users\kingfloyd\.agents\skills\mineru\SKILL.md`（行 28、63-78、82-86、93-101、107-113、130-150）
- `C:\Users\kingfloyd\.agents\skills\mineru\scripts\mparse.py`（行 9-35、62-87、128-153、210-226、274-305、421-431、473-483、530-551、571-587、622-631、654-691、737-787、789-850、879-926）
- `C:\Users\kingfloyd\.agents\skills\mineru\scripts\mineru.py`（行 124-134、137-182）
- DSH 文档：`D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\dsh-doc\references\configuration.md:12`（credentials）、`packages.md:477-481`（subprocess seam）、`composition-reference.md:17`（`dshHomePath`）
- 仓库：`E:\TheCode\ZoteroSeek\src\core\mineru.ts`、`zip.ts`、`types.ts`
- 运行时实测（2026-11-18，`ELECTRON_RUN_AS_NODE=1`）：Electron 44.7.0 / Node 24.21.0 / Chrome 152 / `fetch` function / undici 7.29.1；`fflate@0.8.3` 随 DSH 打包（`app.asar\dsh\node_modules\fflate\package.json:2-4`）

外部链接：

- MinerU API 官方文档（精准解析 / 批量上传 / 批量结果 / 状态枚举 / 错误码）：https://mineru.net/doc/docs/index_en/ ，中文版 https://mineru.net/apiManage/docs
- MinerU API 限流策略：https://mineru.net/doc/docs/limit_en/
- MinerU 输出文件字段（content_list v1/v2 字段表与样例）：https://raw.githubusercontent.com/opendatalab/MinerU/05b0941245831804a488de1460d142bc0bb9aa78/docs/en/reference/output_files.md
- 云端实测（2026-03-04，`pipeline` 2.6.4，zip 清单/状态流转/字段验证，第三方）：https://raw.githubusercontent.com/fufankeji/VibeCodingCourse_v1/refs/heads/main/Week3_Claude_Code_Engineering/Lesson06_Multimodal_RAG_System/GraphRAGAgent/docs/mineru_specification-v1.0.md
