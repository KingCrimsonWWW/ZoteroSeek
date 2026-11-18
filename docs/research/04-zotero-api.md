# Zotero 本地 API 契约 + 检索/分块/引用设计（04）

> 调研日期 2026-11-18。实测环境：Zotero 10.0.8（`X-Zotero-Version`）、API v3 / Schema v44、`http://127.0.0.1:23119`、本机文库 478 对象（238 文献条目 / 227 附件 / 170 PDF）。
> 标记：**【实测】**=本机 curl/Node/Python 请求实测；**【源码】**=Zotero 应用 jar 内 JS 源码；**【skill】**=本机 `zotero`/`mineru` skill 文档；**【文档】**=官方文档/参考实现；**【未验证】**=推断。
> 引用简写见 §11。本文所有结论可直接照抄进 `src/core/zotero.ts` / `bm25.ts` / `chunker.ts`。

## 0. 结论速览

1. 只读场景只需 GET，**无需任何鉴权**；库前缀固定 `/api/users/0/...`（`0`=当前用户）。【实测】
2. **不要用 Zotero 的 `q` 做检索**：它是「空格分词 → 每词在固定字段集内做 OR → 词间 AND 子串」的元数据/全文匹配，无 OR/否定/模糊/语义（源码见 `search.js:315-377`）。真正的检索用我们自己的进程内 BM25（§7）。
3. 附件路径要**两段式**：优先 `links.enclosure.href`（`file:///…/storage/<attKey>/<file>`）；`links` 可能为 `null` 或没有 `enclosure`（linked-file、部分库），必须回退 `<storage>/<attKey>/<filename>`。`data.enclosure` 不存在，别读。【实测＋skill】
4. **引用导出不要自己拼**：`?format=bibtex|biblatex|ris|csljson` 与 `?format=bib`（citeproc HTML，支持 `style`/`locale`）、单条目 JSON 的 `include=bib,citation,bibtex` 都是原生能力，实测可直接产出 APA/IEEE/GB-T 7714 样式。【实测】
5. 解码：Node 的 `fetch(...).text()` 按 UTF-8 解码，安全；Python `requests` 对 `text/plain`（无 charset）会按 ISO-8859-1 解出乱码，必须 `r.content.decode('utf-8')`。BibTeX 响应以 `\n` 开头。【实测】
6. `itemKey=` 是「搜索作用域」不是过滤器：返回请求的条目**及其全部子项**，`limit` 会被子项挤占导致父项丢失；`format=keys/versions` 同理。【实测＋源码】
7. 合集的 `numItems`/`numCollections` 恒为 `null`；文献数要用 `/collections/<key>/items/top` 的 `Total-Results`（`/items` 版含附件子项，会虚高，实测 110 vs 81）。【实测】
8. 性能实测（本机）：全库 478 对象分页扫 4.0s；170 个 PDF 的 `/fulltext` 串行 4.8s（≈28ms/个）；用 170 篇全文切出的 3,485 个 chunk 建 BM25 **1.42s**、堆 +100MB、单查询 **0.42ms**。【实测】

## 1. 连接、传输与响应头

| 项 | 值 | 来源 |
|---|---|---|
| 基址 | `http://127.0.0.1:23119`（只回环；`localhost`/`::1` 同） | 【实测】`zotero_cli.py:255-257` |
| 库前缀 | `/api/users/0`（`0`=当前用户；组库 `/api/groups/<id>` 未验证） | 【实测】`api-notes.md:53` |
| 根探针 | `GET /api/` → `200`、body `Nothing to see here.`，带 `Zotero-API-Version: 3`、`Zotero-Schema-Version: 44`、`Zotero-Server-ID`、`X-Zotero-Version` | 【实测】`api-notes.md:35` |
| 连接器心跳 | `GET /connector/ping`（服务器根，不在库前缀下）→ `200`，body 是 HTML `…Zotero is running`（**不是**纯文本） | 【实测】`api-notes.md:141-145` |
| 鉴权 | GET 不需要；写操作需要 `Zotero-API-Key` + `Zotero-Server-ID`（我们只读，永不使用） | 【skill】`api-notes.md:216-220` |
| 传输 | `HTTP/1.0`、无 `Content-Length`/chunked、靠关连接定界。Node `fetch` 正常；**PowerShell `Invoke-WebRequest` 报 ResponseEnded**；Python 需 `Session.trust_env=False` 防代理拦截 | 【实测】`api-notes.md:14-29` |
| 速率 | 本地无 rate limit | 【skill】`api-notes.md:25-26`、`server_localAPI.js:82-86` |

列表响应头（【实测】`items?limit=2`）：`Total-Results`（过滤后、分页前总数）、`Last-Modified-Version`（库 `clientVersion`，用于增量栅栏）、`Link`（`first/prev/next/last/alternate`）。单对象响应同样带 `Last-Modified-Version`（该对象版本）与 `Total-Results: 1`。【源码】`server_localAPI.js:389-438`。

错误体是纯文本：`404 Not found`（不存在的 key）/ `404 No endpoint found`（错路径）/ `400 Invalid 'sort' value '…'`、`400 Invalid 'format' value '…'`、`400 Only multi-object requests can output keys|versions`、`405`、`412`（Server-ID 不匹配）、`501`（atom）。【实测＋源码】`server_localAPI.js:536-573, 625-638`。

**请求客户端建议（TS）**：`fetch(url, {signal: AbortSignal.timeout(10_000)})`，只加 `Accept: application/json`（实测该头被忽略，格式只认 query 的 `format`），不跟随重定向（本 API 的 302 只出现在 `/file`，我们不跟）。`Zotero-Server-ID` 可用来区分多实例/防串库：响应头里的值与首次读到的不同即视为实例变更。【源码】`server_localAPI.js:612-638`。

## 2. 只读端点清单

基址省略 `http://127.0.0.1:23119`。所有端点均【实测】过 200/业务状态。

| 端点 | 关键参数 | 返回 | 用途/坑 |
|---|---|---|---|
| `GET /api/` | — | 文本+版本头 | 健康检查、取 Server-ID |
| `GET /api/users/0/items` | `limit,start,itemKey,itemType,tag,q,qmode,sort,direction,since,includeTrashed,format,include` | JSON 数组 | 主列表；不加 `limit` 返回全部；含附件/笔记/批注 |
| `GET /api/users/0/items/top` | 同上 | JSON 数组 | **只要文献条目**（无子项的顶层对象）；本机 242 |
| `GET /api/users/0/items/<key>` | `format,include` | JSON 对象 | 单条目/单附件；坏 key→404 |
| `GET /api/users/0/items/<key>/children` | `format` | JSON 数组 | 附件+笔记（批注是**附件**的子项，不再上卷）；**用父 key** |
| `GET /api/users/0/items/<attKey>/fulltext` | — | `{content,indexedPages,totalPages[,indexedChars,totalChars]}` | Zotero 自己抽的纯文本；**只接受文件附件 key**，父条目→404 |
| `GET /api/users/0/items/<attKey>/file` | — | `302`，`Location: file:///…`，空 body | **不流字节**；实测 302 |
| `…/file/view/url` | — | `text/plain` 一行 `file:///` URL | 同上、无 302 |
| `GET /api/users/0/collections` | `limit,start,since,sort` | JSON 数组 | 全部合集（含子合集），17 个；`numItems:null` |
| `GET …/collections/top` | 同上 | JSON 数组 | 根合集 8 个；树=用 `parentCollection` 自建 |
| `GET …/collections/<key>` | — | JSON 对象 | 单合集；坏 key→404 |
| `GET …/collections/<key>/items` | `limit,start,…` | JSON 数组 | 成员**含子附件/笔记**（110）；排除 annotation（源码 1091） |
| `GET …/collections/<key>/items/top` | 同上 | JSON 数组 | 只要文献数时用它（81） |
| `GET …/collections/<key>/collections` | — | JSON 数组 | 子合集 |
| `GET /api/users/0/tags` | `limit,start,since,sort` | JSON 数组 | 全库标签 536 行；**没有 q/tagType 过滤**（源码 1601-1638） |
| `GET …/items/trash` | `limit,start` | JSON 数组 | 回收站 12 条；只读可用 |
| `GET …/fulltext?since=0` | `since`（必填） | `{attKey: version}` | 已建全文索引的对象清单（本机 **225** 项，含 HTML 快照；不是 170 PDF 数）；缺 since→400 |
| `GET …/searches` / `…/groups` | — | 数组 | 本机均为 `[]` |
| 列表 `format=keys` | — | 换行分隔 key 文本 | 仅多对象；单对象→400 |
| 列表 `format=versions` | — | `{key: version}` JSON 对象 | 增量同步核心；单对象→400 |

`/items` 的搜索条件（源码 `server_localAPI.js:1080-1136`）：默认 `includeChildren`；`/top` 用 `noChildren`；`?itemKey=` 走 `key is` 条件；回收站列表 `deleted is true`；`includeTrashed=1` → `includeDeleted`；`q` → `quicksearch-<qmode>` 的 `contains` 条件；`itemType`/`tag` → web-API 语法（§3.3）。

## 3. 过滤、分页、排序、增量（含全部坑）

### 3.1 分页
- 不带 `limit` = 返回**全部**（与 web API 默认 25 不同）；478 对象一次 1.71MB。【实测＋源码 389-398】
- `limit=0` 会被 `parseInt('0') || …` 视为未给 → **返回全部**（坑）。【实测】
- `start` 超界 → `[]`，`Total-Results` 仍为真实总数。【实测】
- 建议：`limit=100` 循环直到 `start >= Total-Results`；或一次取全（本机 4.0s/5 请求，串行；并发 4 可 <1.5s）。

### 3.2 排序
白名单（源码 344-348）：`dateAdded,dateModified,title,creator,itemType,date,publisher,publicationTitle,journalAbbreviation,language,accessDate,libraryCatalog,callNumber,rights,addedBy,numItems`；默认 `dateModified`；`direction` 缺省时 `date*` 为 `desc`，其余 `asc`；`creator` 内部映射 `sortCreator`；非法值→400。【实测：`sort=bogus`→400，`direction=sideways`→400】

### 3.3 itemType / tag 过滤语法（web-API 兼容子集）
`buildSearchFromSearchSyntax`（源码 1840-1864）：**单个参数值内** `||` 表示 OR、前缀 `-` 表示 NOT；**重复传参数**会被拼成 AND（两个不同值→0 条，实测）。
- `?itemType=journalArticle||thesis` → 222（214+8）【实测】
- `?itemType=-attachment` → 243；`?itemType=-note` → 465；`?itemType=-attachment||-note` → 470（**不是**「同时排除」，别用）【实测】
- 不存在的 `itemType` → `200 []`（无 400）【实测】
- `tag=候选` → 78（**精确标签名**，非子串）；`tag=候选||综述` → 80；`tag=-候选` → 392。【实测】
- `tagType` 不被 items 端点处理（实测无差异）。

### 3.4 `q` 的精确语义（**关键**）
`parseSearchString` 按空白分词；双引号内整体作为**一个短语子串**（源码 `searchConditions.js:944-976`）。每个词展开为一个 OR 组，**词与词之间是 AND**（源码 `search.js:315-377`）。

| qmode | 每个词匹配的字段 | 顶层限制 | 命中对象 |
|---|---|---|---|
| `titleCreatorYear`（默认） | key（合法 key 时）、`title`、`publicationTitle`、`shortTitle`、`court`、`year`、`citationKey`、`creator` | `noChildren`（只要顶层） | 条目 |
| `everything` | key、`field`（全部字段）、`tag`、`note`、`annotationText`、`annotationComment`、`creator`、`fulltextContent`（词长≥3 或多词；`fulltext.js:2483-2511`） | 无 | 可能是**附件**，用 `links.up`/`data.parentItem` 升到父条目 |
| `titleCreatorYearNote` | 仅 `note` | — | 笔记 |

实测（元数据 / everything）：`void` 29/170；`laser` 41/159；`void laser` **2/54**；`隧道` 27/70；`衬砌` 20/62；`多普勒` **0**/6；`激光测振` 1/6；`OR` 133/409（`OR` 被当普通词）；`track -void` 0/36（无否定）；`"tunnel lining"` 37/160 vs 不带引号 `tunnel lining` 47/172（引号=短语，本机 10.0.8 与 `api-notes.md:80-100` 的旧结论不同，以本节实测为准）。`q=EHC5UR3B`→1、`q=RapidNoncontactDetection2026`→1（key/citationKey 可搜）。

### 3.5 `itemKey=` 是作用域不是过滤器（**实测坑**）
`itemKey=EHC5UR3B&limit=1` 返回的是它的**子附件** `8P426GTK`，父条目被挤出窗口；`Total-Results` 为 2。`format=keys` 同样返回 `['8P426GTK','EHC5UR3B']`。【实测＋源码 1117-1129, 1152-1160】正确做法：**不传 `limit`** 或用足够大的 `limit`，拿回后自己按 key 过滤；回收站中的 key 在该作用域里查不到。【文档】参考实现 `item-batch.ts:1-15`。

### 3.6 增量/版本
- `Last-Modified-Version` = 库 `clientVersion`；每个对象有自己的 `version`。【源码 410-431】
- `GET /items?since=<v>` 只返回 `clientVersion > v` 的对象（实测 `since=2780`→2 条）；对合集等列表同样生效；组库忽略 `since`。【源码 330-341】
- `GET /items?format=versions` → `{key: version}`（实测 478 项）；配合 `since` 增量拉版本表。
- 条件 GET：请求头 `If-Modified-Since-Version: <v>`，未变更→`304` 空 body（实测）。
- 删除没有 `/items/deleted`（404）；要发现删除只能全量 key 对比（本机 478 条全扫 4s，可接受）或读 `/items/trash`（12 条）做辅助。
- 不要依赖 `link` 的 `alternate`（指向 zotero.org）；`links.self`/`links.up` 是 `http://localhost:23119`。【实测】

### 3.7 明确忽略的参数
`?collection=<key>` 在 `/items` 上**静默忽略**，返回全库（实测 478）——合集成员必须走 `/collections/<key>/items`。【实测】`api-notes.md:112-116`

## 4. 条目元数据

对象形状（源码 `dataObject.js:1494-1531`，实测）：`{key, version, library, links, meta, data}`。真字段全在 `data`。

| 字段 | 类型/说明 | 本机 238 文献覆盖率 |
|---|---|---|
| `data.key` / `data.version` / `data.itemType` | 8 位 key；对象版本；`journalArticle` 等 | 100% |
| `data.title` | 字符串；可能缺 | 99.6% |
| `data.creators` | 数组，两种形态：①`{firstName,lastName,creatorType}` ②中文/机构**单字段** `{name,creatorType}`。`creatorType` 常见 `author`/`editor`/`contributor`；首作者不一定是 author（实测 INMPXHWG：`contributor` 杜彦良 + `author` 耿鹏） | 94.1% |
| `data.date` | 自由文本（`09/2026`、`2018`），年份**别自己正则**，优先 `meta.parsedDate` | 95.4% |
| `data.DOI` | 无前缀（`10.1016/…`） | 87.0% |
| `data.citationKey` | Better BibTeX 写入；本机 238/238 都有，但别假设必有 | 100%（本机） |
| `data.abstractNote` | 纯文本 | 73.1% |
| `data.publicationTitle` / `bookTitle` | 期刊名/书名 | 89.9% / 0.4% |
| `data.tags` | `[{tag,type}]`；`type:1`=自动标签，**手动标签无 `type` 字段** | 88.7% |
| `data.collections` | 合集 key 数组（仅顶层条目有） | 98.3% |
| `data.extra` | 用户杂项（本机是 JCR/中科院分区等） | 83.2% |
| `data.url` / `data.language` | 链接 / 语言（en 136、zh 27） | 96.6% / 68.9% |
| `data.parentItem` | 子对象才有（附件/笔记） | — |
| `data.linkMode` `contentType` `filename` `md5` `mtime` `charset` | 附件字段；`data.path` **仅 linked_file** 有（源码 `item.js:6047-6052`） | — |
| `meta.parsedDate` | `2026-09`、`2018`（解析后的日期，优先取年） | 实测有 |
| `meta.creatorSummary` | 本地化摘要，如 `Liang 等`（中文 locale 的「等」） | 实测有 |
| `meta.numChildren` | 子项数 | 实测有 |
| `links.attachment` | 顶层条目独有：Zotero 选出的**最佳附件** `{href,.../items/<attKey>, attachmentType, attachmentSize}`（本机 161 PDF/3 HTML/1 ZIP） | 165 条目有 |
| `links.enclosure` | 附件独有：`{href:file:///…, type, title, length}` | 227 附件全有（本机） |

真实响应裁剪样例（`GET …/items/EHC5UR3B`，仅保留有用部分）：

```jsonc
{
  "key": "EHC5UR3B", "version": 2196,
  "links": { "self": {"href": "http://localhost:23119/api/users/18913349/items/EHC5UR3B"},
             "attachment": {"href": "http://localhost:23119/api/users/18913349/items/8P426GTK",
                            "attachmentType": "application/pdf", "attachmentSize": 4922172} },
  "meta": {"creatorSummary": "Liang 等", "parsedDate": "2026-09", "numChildren": 1},
  "data": {
    "key": "EHC5UR3B", "version": 2196, "itemType": "journalArticle",
    "title": "Rapid non-contact detection of ballastless track void using laser doppler vibrometry and vibration-based method",
    "date": "09/2026", "DOI": "10.1016/j.measurement.2026.122292",
    "citationKey": "RapidNoncontactDetection2026",
    "publicationTitle": "Measurement", "volume": "285", "pages": "122292",
    "language": "en", "url": "https://linkinghub.elsevier.com/retrieve/pii/S0263224126020014",
    "creators": [{"firstName": "Shichuan", "lastName": "Liang", "creatorType": "author"}, "…3 more"],
    "tags": [{"tag": "/unread", "type": 1}, {"tag": "候选"}, {"tag": "空洞"}],
    "collections": ["TQDRNBL4"], "relations": {},
    "extra": "JCR分区: Q1\n影响因子: 6.1", "dateAdded": "2026-10-22T08:48:04Z"
  }
}
```

中文单字段作者样例（`…/items/6V9CA86B`）：`"creators":[{"name":"申艳军","creatorType":"author"},…6 人]`，`"citationKey":"ShenYanJun…2018"`，`"publicationTitle":"隧道建设（中英文）"`。

附件样例（`…/items/8P426GTK`）：`links.enclosure.href = file:///C:/Users/kingfloyd/Zotero/storage/8P426GTK/Liang%20%E7%AD%89%20-%202026%20-%20…pdf`，`links.enclosure.length=4922172`；`data = {itemType:"attachment", parentItem:"EHC5UR3B", linkMode:"imported_file", contentType:"application/pdf", filename:"Liang 等 - 2026 - ….pdf", md5:"4a279a…", mtime:1792997465691}`（本机 `data.path` 不存在【实测】）。

## 5. 附件与 PDF 路径解析

规则（源码 `item.js:6047-6052, 6177-6183, 6216-6229, 2899-2949, 3417-3426`）：

1. `links.enclosure` **仅对 imported 附件**（`imported_file` 导入文件 / `imported_url` 网页快照）生成；`linked_url`（纯链接）无本地文件可读；`linked_file` 无 enclosure，路径在 `data.path`（绝对或 `attachments:` 相对）。
2. **`links` 可能为 `null`**（本机 10.0.8 未出现，但 skill 已在其他库遇到）：`mineru/SKILL.md:122-125`，`zotero_cli.py:500-511` 的 `links or {}` 防御。⇒ 一律 `item.links ?? {}`，不得 `item.links.enclosure` 直接取。
3. 兜底：`<storageRoot>/<attKey>/<filename>`；storage 根优先从**任一** enclosure 的 `file:///…/storage/<KEY>/<file>` 反推（取 `storage` 段为止），否则 `%USERPROFILE%\Zotero\storage`（可用 `ZOTERO_STORAGE` 覆盖）。【实测】本机 `C:\Users\kingfloyd\Zotero\storage\8P426GTK\` 内 = `.zotero-ft-cache` + PDF，布局确认。
4. `file:///…` 解码：去掉 `file://`，`/C:/…` → `C:/…`，`decodeURIComponent`，`/`→`\`，再 `path.normalize`（`zotero_cli.py:177-197`）。
5. 判断「有没有 PDF」最省事：父条目 `links.attachment.attachmentType === 'application/pdf'`（本机 161/161 与真实 PDF 父项一致；但**最佳附件**可能是 HTML/ZIP——本机 3+1，所以必须判 type）。另外可用 `contentType==='application/pdf' || /\.pdf$/i` 的附件记录（含孤儿顶层附件）。
6. 一个条目可能有多份 PDF（本机 7 个条目各 2 份；`api-notes.md:180-184` 记录过其中一对实为两篇不同论文）；**不要默认取第一个**，优先 `links.attachment`，多份时把选择交给用户。孤儿顶层 PDF 2 个（无 `parentItem`，只能从 `/items?itemType=attachment` 侧看到）。
7. `/items/<att>/file` 是 302 + 空 body（`Location: file:///…`），**永远不要指望 HTTP 拿到字节**；要字节直接读磁盘路径。

可直接照抄的 TS 解析（与现有 `zotero.ts:164-249` 对齐，修正点见 §10）：

```ts
// 输入：父条目 raw（含 links.attachment）+ 可选的附件 raw
function enclosurePath(att: any): string | null {
  const href = att?.links?.enclosure?.href;
  if (typeof href !== 'string' || !href.startsWith('file://')) return null;
  let p = decodeURIComponent(href.replace(/^file:\/\/\/(?=[A-Za-z]:)/, '').replace(/^file:\/\//, ''));
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);       // /C:/x -> C:/x
  return process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
}
function storageRootFrom(encPath: string): string | null {
  const m = /^(.*[\\/]storage)[\\/][^\\/]+[\\/][^\\/]+$/i.exec(encPath);
  return m ? m[1] : null;
}
// 分支：enclosure -> data.path（linked_file）-> <root>/<attKey>/<filename>
```

Zotero 自有全文：`GET /items/<attKey>/fulltext`。本机 **170/170** PDF 均可取；`content` 中位 53,723 字符、最短 4,578、最长 234,110，全部 9.51M 字符（CJK 仅 6.1%——本库以英文为主）；`indexedPages/totalPages` 最长 154 页（Zotero 抽全文上限 100 页/文件，`api-notes.md:176-178`）。它是「扁平文本流」，**表格结构/图/公式会丢**；表格/公式敏感的问题必须用 MinerU 产物。【实测＋skill】

## 6. 导出与引用（本地 API 原生能力）

**Accept 头无效**：`Accept: application/x-bibtex|application/x-csljson|text/html` 实测全部返回 `application/json`。导出只认 query `?format=`。【实测，源码 531-576】

`format` 白名单（源码 223-238）：`bibtex, biblatex, bookmarks, coins, csljson, csv, mods, refer, rdf_bibliontology, rdf_dc, rdf_zotero, ris, tei, wikipedia` + `bib`（citeproc HTML）、`keys`、`versions`、`json`（默认）、`atom`（501）。单条/多条都支持；`Content-Type` 均为 `text/plain`（`format=json/versions` 除外）。

| 请求 | 结果（实测） |
|---|---|
| `…/items/EHC5UR3B?format=bibtex` | 985B，`@article{RapidNoncontactDetection2026,…}`，含 `file={…:C\:\\Users\\…\\storage\\8P426GTK\\…pdf:application/pdf}` |
| `…/items/EHC5UR3B?format=biblatex` | 1015B，`date`/`journaltitle` 字段风格 |
| `…/items/EHC5UR3B?format=csljson` | 981B；`id` = **citationKey**（`RapidNoncontactDetection2026`），`citation-key` 同值，`issued.date-parts` 有值 |
| `…/items?itemKey=A,B&format=bibtex` | 合并导出；`Total-Results` 含子项（=4），实际条目 2；附件/批注不会被导出（源码 1813-1819） |
| `…/items/EHC5UR3B?format=bib&style=apa` | `text/html`：`<div class="csl-bib-body"><div class="csl-entry">Liang, S., … (2026). …</div>` |
| `…/items/EHC5UR3B?format=bib&style=ieee` | 数字编号：`<div class="csl-left-margin">[1]</div>…` |
| `…/items?itemKey=A,B&format=bib&style=apa&locale=zh-CN` | 两条合并参考文献表（HTML） |
| `…/items/6V9CA86B?format=bib&style=<GB样式ID>&locale=zh-CN` | `[1] 申艳军, 杨阳, 邹晓龙, 等. 国内公路隧道…` |
| `…/items/EHC5UR3B?include=data,citation&style=apa&locale=zh-CN` | JSON 增加 `citation` 字段：`"(Liang等, 2026)"`（APA+中文 locale 用「等」） |
| `…/items/EHC5UR3B?include=citation` | 只有 `citation`，**`data` 被删**（源码 1727-1752） |
| `…/items/EHC5UR3B?include=bibtex,biblatex,csljson` | JSON 顶层增加同名键（4,529B） |

`format=bib` 参数（源码 1764-1803）：`style` 缺省 `chicago-shortened-notes-bibliography`；`locale` 缺省 `en-US`；`linkwrap=1` 给 DOI/URL 包 `<a>`。**style 解析顺序**：本地已装样式 → 尝试 `https://www.zotero.org/styles/<name>` 下载并**安装到 Zotero profile** → 失败 400（实测 `style=not-a-style-xyz` 报 `Invalid style: … failed with status code 404`）。因此：**只用本地白名单样式**，绝不把用户输入直接塞进 `style`。本机已装（`C:\Users\kingfloyd\Zotero\styles\`）：`apa`、`ieee`、`chicago-author-date`、`chicago-notes-bibliography`、`nature`、`american-medical-association`、`american-chemical-society`、`elsevier-harvard`、`modern-language-association`、`nlm-citation-sequence`、`mhra-notes`、`american-sociological-association`、`american-political-science-association`、`harvard-cite-them-right`，以及两个中文 GB/T 7714 样式（其 `style` 需传完整 ID：`https://zotero-chinese.com/styles/GB-T-7714—2015（顺序编码，双语，姓名不大写，无URL、DOI）`，实测可用）。【实测】

解码：
- **TS/Node**：`const text = await res.text()` —— WHATWG 规定 `text()` 恒按 UTF-8 解码，实测中文 BibTeX 正确，且 `new TextDecoder('utf-8')` 结果与 `text()` 完全一致。【实测】
- **Python**：`requests` 对无 charset 的 `text/plain` 猜 ISO-8859-1 → 乱码；必须 `r.content.decode('utf-8')`。【实测】`zotero_cli.py:233-236`
- BibTeX/BibLaTeX 响应以 `\n` 开头，长度校验/空判时先 trim。【实测】

自己拼 BibTeX 的备选（当导出不可用/需要可控字段时，例如给面板直接展示）：

```ts
const TYPE: Record<string,string> = { journalArticle:"article", bookSection:"incollection", thesis:"phdthesis", conferencePaper:"inproceedings", book:"book", report:"techreport", webpage:"misc", document:"misc" };
function authorField(creators: {firstName?:string;lastName?:string;name?:string;creatorType?:string}[]): string {
  const authors = creators.filter(c => (c.creatorType ?? "author") === "author");
  return authors.map(c => c.name ?? [c.lastName, c.firstName].filter(Boolean).join(", ")).join(" and ");
}
// 键：citationKey ?? `${firstAuthorLastName}${year}${title.slice(0,3)}`；字段：title/author/year/journal/volume/pages/doi/url；
// 转义 { } \，中文标题原样保留（UTF-8 写出），无 DOI 就删字段（不要输出 doi = {}）。
```

## 7. 检索设计：进程内 BM25（本库 170 篇 / 数千 chunk）

当前实现 `src/core/bm25.ts` 已在位且设计正确，本节给出实测依据与调参边界，**不需要换向量库**。

### 7.1 Tokenization（`bm25.ts:37-74`，建议保持）
- 拉丁字母/数字：连续串整体转小写；长度≥2 保留、纯数字长度≥2 保留；英文停用词（the/a/of/…）丢弃。
- CJK（`\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff`）：连续汉字段切成**二元 bigram**（`隧道衬砌`→`隧道/道衬/衬砌`）；单字段保留单字但过滤虚词表（`的了和与…`）。这是零依赖的「轻分词器」，对中文术语召回稳定。
- 标点/公式符号不产生 token，但公式里的字母数字会被切出。
- **缺口（实测）**：没有英文词干。同一索引下 `voids` 命中、`void` 0；`detection` 命中、`detect`/`detecting` 0。建议补**保守后缀归一**：`s/es`（长度>3）、`ing/ed`（长度>5，且只保留前 4+ 字符），建索引与查询用同一函数；或查询侧同时展开候选形式（`detect → detect/detection/detecting`）。别上完整 Porter：收益小、调试成本高，且本库查询多是术语/编号。
- 查询侧先去重（`new Set(tokenize(q))`），空/全停用词直接返回 `[]` 并在 UI 说明「没有可检索词」。

### 7.2 打分与参数
`score = Σ_t idf(t) · tf_w(t,d)·(k1+1) / (tf_w(t,d) + k1·(1-b+b·|d|/avgdl))`，`idf = ln(1+(N-df+0.5)/(df+0.5))`（恒正）。现有默认：`k1=1.2, b=0.75`，字段加权 `title×3, section×2, text×1`（权重直接计入 tf 与文档长度，`bm25.ts:107-188`）；同参数在参考实现里也是 `k1=1.2, b=0.75`（`dsh-zotero/docs/architecture.md`「原文检索用 BM25」），两处独立收敛，可作为简历里的依据。
- 调参：`k1∈[1.2,2.0]`（越大越奖励重复术语）；`b∈[0.6,0.8]`（表格/公式原子块会让块长方差大，本库保持 0.75 即可）。
- 字段权重不建议再高：标题只有一行，×3 已能把「标题互含」的文献顶上来；sectionPath 是短文本，×2 合理。
- `matched` 返回命中词（按贡献截断 8 个），用于「为什么命中」与评测，不需要再算第二遍。

### 7.3 性能（本机实测，方法与规模）
用 170 个 PDF 的 Zotero 全文按 2,800 字符滑窗造 3,485 个「准 chunk」（≈800 token 级），直接 `import Bm25Index` 建索引：

| 指标 | 实测 |
|---|---|
| 建索引（3,485 docs / 2.81M token） | **1.42 s**，堆增量 **+100 MB** |
| 单查询（5 类中英 query × 20 次） | 平均 **0.42 ms**，最大 1.99 ms |
| chunk 文本 JSON 体积 | 9.6 MB，`JSON.stringify` 44 ms / `JSON.parse` 27 ms |
| 全库元数据（478 对象，分页 100） | 4.0 s（5 次串行请求；并发 4 可 <1.5 s） |
| 170 个 `/fulltext`（串行） | 4.8 s（≈28 ms/个；并发 6 → ≈1 s） |

规模结论：170 篇 ≈ **3.5k–4k chunk**（按 token 估算约 3,948），BM25 查/建都远低于交互阈值；`index.json` 10MB 级可接受。到 **>500 篇 / >1.5 万 chunk** 时再考虑 SQLite FTS5（把 `Library.rebuild` 换掉即可，接口不变）；内存按实测外推：3k chunk ≈ +100MB 堆，1.5 万 chunk ≈ 400–500MB，届时必须换 FTS5。【实测】

### 7.4 检索编排建议
1. 先用 Zotero 元数据做「范围/过滤」：`/items/top` 拉条目（一次），本地按 `itemType`/`tags`/`collections`/年份过滤；**不要**用 `q` 做主题检索。
2. 用 BM25 在 chunk 上打分；`topK` 8–12；`itemKey` 可选限定单篇。
3. 结果按需补元数据：命中→`itemKey`→本地条目表（已缓存），不额外请求。
4. 面板列表/筛选（年份、有无附件）用「一次全量扫描 + 内存缓存 + `Last-Modified-Version` 栅栏」而不是逐条 `/children`（参考实现 `search-index.ts` 的过滤索引思路，URL 见 §11）。

## 8. 分块：MinerU content_list 系 → chunk

产物与字段以 `docs/research/03-mineru-api.md` §4.2-4.4 为准；本节只定「切法 + 元数据」。

输入优先级：`content_list.json`（v1，扁平、字段可逐项核实、带 `page_idx` 与 0-1000 归一化 `bbox`）=**主源**；`content_list_v2.json`（官方契约是 `list[list[dict]]` 按页分组，云端口径**未在本机验证**）=可选增强，页号=外层下标（0 起），块结构防御式解析，未知结构降级回 v1；`full.md`=最后兜底（无页码，`page:null`）。【文档】`03-mineru-api.md:297-348`；【skill】`mineru/SKILL.md:60-78,144-150`；【源码】`mparse.py:22,836-839,893-895`。

切块算法（与现有 `chunker.ts:43-115` 一致，可直接照抄常量）：

```ts
const DEFAULTS = { maxTokens: 800, overlapTokens: 100, minTokens: 40 };
// 1) 按阅读顺序遍历块；标题块先入 sectionStack（同级替换、低级别出栈），sectionPath = stack.join(' > ')
// 2) 表格/公式/代码 = 原子块，绝不在块内切；原子块使 buffer 超 2*maxTokens 时先 flush 再接（超长表格独占 chunk）
// 3) 非原子块：bufferTokens + tokens > maxTokens 且 buffer 非空 → flush；随后追加，>=maxTokens 时再 flush
// 4) flush：text = blocks.map(b => b.text).join('\n\n')（< minTokens 丢弃）；page = 首块 page；kind = 按字符数取最大类
// 5) overlap：从 buffer 尾部回取块，累计 <= overlapTokens（按整块回取，不切块内）
```

v2 解析防御：若 `raw[0]` 是数组 → 外层=页、`page=index`；若元素是 `{page_idx,blocks:[…]}` → 用其 `blocks`；单块字段按 `type` 分派（`text/title/table/image/equation/code/list`），标题级别取 `text_level`（1-6）或 `type==='title'`，表格取 `table_body`+`table_caption`+`table_footnote` 拼接、图片取 `image_caption`/`img_path`、公式取 `text|latex`。缺 `page_idx` 时用外层页下标。（`chunker.ts:117-205` 已实现一半，需补 `{page_idx,blocks}` 形态。）

chunk 元数据（与 `types.ts:56-71` 对齐，必须存）：

| 字段 | 说明 |
|---|---|
| `chunkId` | `<itemKey>:<seq:04d>`，全库唯一、稳定（同源重解析 seq 可变，面板别把它当永久引用；永久引用用 itemKey+page） |
| `itemKey` / `title` | 冗余标题，检索结果免二次查表 |
| `sectionPath` | 如 `3 Methods > 3.2 Void detection`，用于加权与展示 |
| `page` | **0 起**（MinerU `page_idx` 口径；展示时 +1）——现有 `types.ts:63` 注释写「1 起」但 `chunker.ts:65` 实际填 0 起、`grounding.ts:47` 又 +1，注释与代码矛盾，统一按 0 起并改注释 |
| `kind` | `text/table/equation/figure`（`dominantKind`） |
| `text` | 块拼接原文（表格保留 HTML、公式保留 LaTeX） |
| `tokenEstimate` | `cjk*1 + latin/4 + other*0.25`（`chunker.ts:30-40`） |
| （建议新增）`anchor` | `{blockIndex?, bbox?}`：content_list 的块下标/`bbox`，右侧面板「勾选引用」时用它定位原文高亮；没有就退化为 page |

验收：解析首篇后人工核对 ① 每个 chunk `text` 非空且不含页眉页脚；② 表格/公式没有被拦腰截断；③ `page` 与 PDF 实际页一致（0 起）；④ chunk 数落在 `总 token/800` 的 ±20%。

## 9. 引文格式（两套最小实现）

现有正文引用是「检索片段编号 `[^N^]`」（`grounding.ts:56-79`），**不要动**：它服务于引用可验证。本文的 author-year / 数字编号用于**参考文献表、面板复制、导出**，两者由 `chunkId→itemKey→条目` 映射衔接。

**方案 A（推荐，Zotero citeproc 直接生成，零维护）**
```ts
// 行内（作者-年份 / 数字）：拿 citation 字段，两种风格都可能，去 HTML
const r = await fetch(`${root}/items?itemKey=${keys.join(",")}&format=json&include=data,citation&style=apa&locale=zh-CN`);
// -> [{..., citation: "(Liang等, 2026)"}]
// 参考文献表：
const b = await fetch(`${root}/items?itemKey=${keys.join(",")}&format=bib&style=apa&locale=zh-CN`);
const html = await b.text();                 // <div class="csl-bib-body"><div class="csl-entry">…</div></div>
const entries = [...html.matchAll(/<div class="csl-entry">([\s\S]*?)<\/div>/g)].map(m => stripTags(m[1]));
function stripTags(s: string): string { return s.replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim(); }
```
`style` 白名单：`apa`（作者-年份）、`ieee`/`nature`（数字）、`chicago-author-date`、GB/T 7714（完整 style ID 见 §6）；`locale=zh-CN` 让中文条目出现「等」、英文条目出现「et al.」——本机实测 APA+zh-CN=「(Liang等, 2026)」、APA+en-US 对中文作者=「(申艳军 et al., 2018)」。未知 style 会联网下载并**写入 Zotero profile**，禁止透传用户输入。

**方案 B（自拼，API 不可用或要完全可控格式时）**
```ts
type C = { firstName?: string; lastName?: string; name?: string; creatorType?: string };
type It = { data: { creators?: C[]; date?: string | null; title?: string }; meta?: { parsedDate?: string } };
const isCJK = (s: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(s);
const displayName = (c: C): string => c.name ?? [c.lastName, c.firstName].filter(Boolean).join(", "); // 参考文献用全名
const surname = (c: C): string => c.name ?? c.lastName ?? c.firstName ?? "";                          // 行内只用姓/中文全名
const authorsOf = (it: It): C[] => (it.data.creators ?? []).filter(c => (c.creatorType ?? "author") === "author");
function authorYear(it: It): string {                       // "Liang et al., 2026" | "申艳军 等, 2018" | "A & B, 2019"
  const authors = authorsOf(it);
  const latin = !isCJK(authors[0] ? surname(authors[0]) : (it.data.title ?? ""));
  const etal = authors.length >= 3 ? (latin ? " et al." : " 等") : "";
  const lead = authors.length === 0 ? (latin ? "Anon." : "佚名")
    : authors.length === 2 ? `${surname(authors[0]!)}${latin ? " & " : "、"}${surname(authors[1]!)}`
    : surname(authors[0]!);
  const year = it.meta?.parsedDate?.slice(0, 4) ?? /\d{4}/.exec(it.data.date ?? "")?.[0] ?? "n.d.";
  return `${lead}${etal}, ${year}`;
}
// 数字编号：按首次出现顺序编号 [1]..[n]，参考文献表按编号排；chunkId→itemKey 去重后编号
```
降级规则（必须实现，本机真实缺字段案例已列）：

| 缺失/异常 | 行内降级 | 参考文献表降级 |
|---|---|---|
| 无 `creators`（本机 14/238，如 K896SIAR） | `Anon.`/`佚名`，或退用 `citationKey` 首段 | 以标题开头（`title. year.`） |
| 首位 creator 非 author（INMPXHWG：contributor 在前） | 只从 `creatorType==='author'` 里取第一作者；全无 author 才用非 author 首位 | 同上 |
| 无 `date`（本机 11/238，多为脏条目） | `n.d.` | `(n.d.)` 或省略年份，不猜 |
| 中文单字段名（本机 36 条文献） | 全名 + 「等」；**不拆姓/名、不加逗号、不首字母缩写** | 原样全名 |
| 作者 1 人 | 单名，无 et al. | 全列 |
| 作者 2 人 | `A & B` / `A、B` | 全列 |
| 作者 ≥3 | `A et al.` / `A 等` | APA 列前 20；GB 列前 3 + 等 |
| 无 DOI/URL | 不输出该字段（不要输出 `doi = {}`） | 省略 |
| 无 `citationKey` | 生成 `FirstAuthorYear` 并去重；导出 BibTeX 时同键 | — |
| 表格/公式块 | 引用照常标页；不复制表格为引用文本 | — |

## 10. 只读实现约束（施工 checklist）

1. **只发 GET**。禁止 `POST/PUT/PATCH/DELETE`、`/api/local/authorize`、任何 `Zotero-API-Key` 头；`Zotero-Server-ID` 只作为读请求的实例断言（不匹配应报错而不是继续），绝不用于写；禁止用 `DELETE` 做「写权限探测」。【skill】`api-notes.md:216-240`
2. 不读 Zotero `prefs.js`（含同步凭据）；不读写 Zotero SQLite；不修改 `storage/` 内任何文件；不删除 `.zotero-ft-cache`。只 `fs.access/stat/readFile`（PDF 交给 MinerU 时只读上传）。【skill】`api-notes.md:107`
3. 不安装 CSL 样式：`format=bib` 的 `style` 只接受 §6 白名单；越界→本地报错，不请求。
4. 请求范围固定回环：`new URL(base).hostname ∈ {127.0.0.1, localhost, ::1}`；不跟随重定向（`redirect:'manual'` 或直接不走 `/file`）。
5. 并发与内存上限：Zotero 本地无 rate limit，但 `/fulltext` 单响应最长 23.4 万字符、全库 9.5M 字符；并发 ≤6，单响应上限 ~4MB（分页 100 时约 0.4MB），全文只按需抓并使用 LRU（本机 170 篇全抓仅 4.8s，真实按需更省）。
6. 超时 10s/请求；错误分类：`connect refused`→提示「Zotero 未运行或本地 API 未开」（设置→高级→允许其他应用与 Zotero 通信）；`404`→条目可能已被删/被合并（`dc:replaces` 关系，`api-notes.md:186-190`）；其他非 2xx→带状态码与路径报告。
7. 缓存正确性用版本栅栏：索引记录 `Last-Modified-Version` + `Zotero-Server-ID`；刷新时先比版本，相同不重扫；实例变更（Server-ID 不同）清空缓存。参考实现同款做法（`search-index.ts`、`item-batch.ts`，URL 见 §11）。
8. 回收站默认排除；只有面板「回收站」视图显式传 `includeTrashed=1`/`/items/trash`。
9. 面板「勾选引用」只产生本地引用选择（itemKey + chunkId + page），**不回写 Zotero**（不加标签、不建笔记、不导条目标注）。
10. DSH 宿主插件形态：`export function apply(ctx, config)`（或 default service class），资源一律在 `apply` 内用 `ctx.effect`/`ctx.on` 注册并返回清理；配置 schema 用 `export const Config`；不写 profile 目录、不碰 `dsh` 安装目录。【文档】`host-plugin.md:58-65`；DSH 桌面运行时 Node 自带 `fetch`（`03-mineru-api.md:15`）。
11. 日志脱敏：不打印全文正文（可截 120 字符）、不打印绝对路径的用户名段之外的隐私、不打印任何 token。
12. 只读验收（照抄执行）：
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:23119/api/
curl.exe -s http://127.0.0.1:23119/api/users/0/items?limit=1
curl.exe -s http://127.0.0.1:23119/api/users/0/items/EHC5UR3B
curl.exe -s "http://127.0.0.1:23119/api/users/0/items?format=versions&limit=2"
# 判定：以上全 200；对 Zotero 目录无任何新写入；文库版本号不变（Last-Modified-Version 前后相同）
```

### 对现有代码的必改点（实测对照）
1. `zotero.ts:209-218`：`itemCount` 取 `entry.meta?.numChildren` 恒为 0——`/collections` 根本没有这个字段；改为对每个合集请求 `/collections/<key>/items/top` 取 `Total-Results`（或 `/collections` 之后按需懒加载）。
2. `zotero.ts:164-186` `resolvePdf`：优先用父条目 `links.attachment`（含 `attachmentType/attachmentSize`），不要逐条 `/children` 后取第一个；`linked_file` 无 `filename` 时要走 `data.path`，否则会误判「无 PDF」。
3. `zotero.ts:238-249`：storage 根回退只写了 `homedir()/Zotero/storage`，建议支持 `ZOTERO_STORAGE`/配置覆盖，并在 `links:null` 时保留兜底（当前逻辑已能兜住 enclosure 缺失，但未处理 `links === null` 的显式分支）。
4. `types.ts:63` 与 `chunker.ts:65`/`grounding.ts:47`：`Chunk.page` 的 0/1 起约定不一致，统一为 **0 起**（MinerU 口径），展示时 +1。
5. `zotero.ts:202-207`：BibTeX 用 `format=bibtex` 已正确；若要给面板展示「作者-年份」引文，增加 `format=bib|include=citation` 路径（§9 方案 A）。
6. `library.ts:237-256`：`readBlocks` 的 v2 分支需补 `{page_idx, blocks}` 形态（见 §8）；`mineru.ts` 完成判定需接受 content_list v1/v2 任一存在（见 `03-mineru-api.md:468`）。

## 11. 来源

- 本机 skill：`C:\Users\kingfloyd\.agents\skills\zotero\SKILL.md`、`references/api-notes.md`、`scripts/zotero_cli.py`；`C:\Users\kingfloyd\.agents\skills\mineru\SKILL.md`、`scripts\mparse.py`。
- Zotero 10.0.8 源码（从 `D:\Zotero\app\omni.ja` 解出后逐行核对，行号即包内行号）：`chrome/content/zotero/xpcom/server/server_localAPI.js`、`xpcom/server/server.js`、`xpcom/data/item.js`、`xpcom/data/dataObject.js`、`xpcom/data/search.js`、`xpcom/data/searchConditions.js`、`xpcom/fulltext.js`。提取方法：Python `zipfile.ZipFile(r'D:\Zotero\app\omni.ja').read(name)`。
- 项目内文档/代码：`E:\TheCode\ZoteroSeek\docs\research\03-mineru-api.md`（产物字段与下载契约）、`src/core/types.ts`、`src/core/bm25.ts`、`src/core/chunker.ts`、`src/core/zotero.ts`、`src/core/library.ts`、`src/core/grounding.ts`。
- DSH：`D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\dsh-doc\references\host-plugin.md`。
- 参考实现（MIT，仅借鉴设计）：<https://raw.githubusercontent.com/Vncntvx/dsh-zotero/main/src/local/search-index.ts>（过滤索引+版本栅栏）、<https://raw.githubusercontent.com/Vncntvx/dsh-zotero/main/src/local/item-batch.ts>（itemKey 批量读）、<https://raw.githubusercontent.com/Vncntvx/dsh-zotero/main/docs/architecture.md>（BM25 k1=1.2 b=0.75）。
- MinerU 官方输出契约：<https://raw.githubusercontent.com/opendatalab/MinerU/master/docs/en/reference/output_files.md>（`CONTENT_LIST_V2 = list[list[dict]]`）。
- Zotero web API v3/local API：<https://www.zotero.org/support/dev/web_api/v3/local_api>、<https://www.zotero.org/support/dev/web_api/v3/basics>。

## 12. 未验证项（别写进用户承诺）

- group 库（`/api/groups/<id>/…`）、保存的搜索可执行性（`/searches/<key>/items`）：本机 `[]`，未测。
- `linked_file` 附件的 `data.path` 实际取值与 `enclosure` 行为：本机无此类附件，仅源码推断。
- `content_list_v2.json` 云端真实块字段（本机无 MinerU 产物/token 过期）：按官方 `list[list[dict]]` + v1 字段做防御式解析，首篇解析后必须回填 fixture。
- `/collections`、`/tags` 的 `since`/`sort` 组合：源码支持，未逐项实测。
- 被合并条目 `dc:replaces` 关系链的自动解析：`api-notes.md:186-190` 描述，未在本机复现。
