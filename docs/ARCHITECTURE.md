# ZoteroSeek 架构

本文件说明「为什么这样分层」「数据怎么流」「出错时谁来兜底」。代码在 `src/`，可安装产物在 `plugin/`。

## 1. 分层

```text
src/core/*        纯领域层：HTTP 客户端、解析、分块、检索、引用格式、grounded 生成
src/host/*        DSH Host 半边：Runtime 装配、工具注册、面板 HTTP 路由、提示词注入
src/client/*      DSH Client 半边：右侧边栏面板（React，无第三方依赖）
plugin/*          esbuild 打出的可安装 bundle（Host: ESM / Client: 模块加载器格式）
```

约束：

- `core/` 不 import 任何 DSH API，也不 import `host/`、`client/`。它是 `node --test` 的直接测试对象，也是「换宿主」时的可复用部分。
- `host/` 不 import `@deepseek-ai/*`：注册工具所需的 `ToolDefinition` 是纯 JSON 结构（`name/description/parameters/output{schema,render}/execute`），手写即可，bundle 因此零运行时依赖。
- `client/` 只通过 HTTP 与 Host 通信，不 import 任何 Harness Client 包（`react` 由宿主模块表提供）。

## 2. 三条数据流

### 2.1 入库：PDF → Markdown → chunk → 索引

```text
Zotero item_key
  → /items/<key>/children 找 PDF 附件
  → storage/<attKey>/<filename>（links.enclosure 优先，缺失时回退 ~/Zotero/storage）
  → 读字节 → sha1 → fingerprint = sha1(pdf) + 解析参数(model_version/language/ocr/page_ranges)
  → 命中 ~/.zotero-seek/parsed/<sha1(fingerprint)[:16]>/full.md ？ 直接返回
  → 否则 MinerU 四步：创建批次 → PUT 上传 → 轮询 extract-results → 下载 zip → 解压
  → content_list.json 为主（v1 字段有官方口径），v2 可选增强，full.md 兜底
  → blocksFromContentList → buildChunks（章节栈 + 800/100 目标 + 表格/公式原子）
  → Library.ingest：替换该条目旧 chunk → 重建 BM25 → 原子写 index.json
```

要点：

- **内容寻址缓存**：目录名只由内容与解析参数决定，所以同一份 PDF 换条目、换标题都不重复计费；改了 `--pages`/`--language` 自然产生新解析。
- **配额台账**：MinerU 没有「查询剩余额度」接口，`mineru-ledger.json` 按北京时间记每日页数（页数为本地估算，用于预警而不是账单）。
- **原子替换**：解析先写 `*.tmp-<ts>` 再 rename，避免半成品被当成缓存命中。
- **只读 Zotero**：没有任何写回。

### 2.2 问答：Agent 调工具

```text
用户问题
  → Agent 调 zotero_search（BM25，返回 chunk_id/章节/页码/片段）
  → 片段不够时调 zotero_read（按 chunk_id 读全文 / 按 item_key 看章节结构）
  → 回答里的引用写成 [来源: chunk_id]
  → （可选）zotero_cite 生成 author-year / reference / bibtex
```

系统提示词里注入的「引用契约」（`src/host/index.ts`）：

- 回答文献内容前必须先检索；
- `chunk_id` 只能原样复制检索结果里的值；
- 检索结果里没有的事实不写，直接说「文献库中没有相关内容」，并指出可以先 `zotero_index` 哪篇；
- 不编造标题/作者/年份/页码/数值。

为什么不用纯文本编号 `[^3^]`：`chunk_id` 是索引里的稳定主键，事后可以程序化核对「这条引用是否真实存在」「是否在本轮检索结果里」。编号只在单次工具结果内有意义，跨轮就没法验证。

### 2.3 面板：右侧边栏

```text
Client 面板 ── fetch /zotero-seek/api/* ──► Host 路由（同一进程）
  /api/status       Zotero 连通、MinerU token 有效性、索引规模
  /api/library      条目列表（本地索引 + Zotero 元数据检索兜底）
  /api/search       BM25 命中（面板与工具共用同一个检索入口）
  /api/markdown     选中条目的 full.md + 分块概览
  /api/index        MinerU 解析入库（长任务，直接 await）
  /api/cite         勾选条目 → 引用文本（bibtex 用 Zotero 自己的导出）
  /file             解析目录里的插图（路径必须落在该条目解析目录内）
```

面板是「核对界面」：左列文献、中栏原文（标题/表格/公式/插图都在）、右栏命中片段；勾选后可以「引用到对话」（通过 `inputActions.insertQuote`）或复制行内引用/参考文献/BibTeX。

### 2.4 grounded 生成器（评测与「一键总结」）

`core/grounding.ts` 是一条**确定性的最小循环**：检索一次 → 生成 → 校验引用 → 不合法带纠正提示重试一次 → 仍不合法就剥离非法标记并标注 `citations_stripped`。

它不放进产品主路径（主路径是 Agent 自己的多步循环），存在的意义是：

1. 评测需要可复现的生成侧指标（`citation_accuracy`、`answer_rate`）；
2. 面板的「一键总结」需要一个不依赖会话状态的生成入口。

模型调用通过 `complete(prompt)` 注入，评测脚本和插件可以共用同一份逻辑。

## 3. 分块与检索

**分块**（`core/chunker.ts`）：

- 目标 800 tokens / 重叠 100 / 最小 40（可按文献调）；
- 表格（HTML）、公式（`$$…$$`）、代码块是**原子块**，绝不切开；单个超大原子块独立成块；
- 每块记录：`chunkId = <itemKey>:<seq>`、`sectionPath`（如 `3 方法 > 3.2 空洞识别`）、`page`（0 起）、`kind`、`tokenEstimate`；
- `sectionPath` 在 chunk **起点**定格（不是 flush 时读栈），这样跨章节的缓冲区不会把后半段算成新章节。

**检索**（`core/bm25.ts`）：

- 中文按二元 bigram 切（`隧道衬砌` → `隧道/道衬/衬砌`），英文小写、去停用词，数字保留；
- 字段加权体现在词频：标题 ×3、章节路径 ×2、正文 ×1，长度归一化用加权长度；
- idf 用 `ln(1 + (N-df+0.5)/(df+0.5))`（恒正，避免停用词负分）；
- 返回命中词列表（`matched`），便于解释与调参；
- 单篇内检索走临时小索引，不把过滤逻辑塞进 BM25。

### 3.1 跨语言检索：两路召回 + 准入 + RRF

中文提问、英文文献是这个库里的常态，而 BM25 的词面匹配跨不过语言。做法（`core/glossary.ts` + `core/rrf.ts`，都在 `Library.searchDetailed` 里编排）：

```text
query ──┬─ ① lexical：原查询 BM25
        ├─ ② expanded：原查询 + 词表扩展词 BM25
        └─ ③ translated：只用扩展词 BM25（中文问英文时=纯英文查询）
                ↓
        RRF 融合（k=10，权重 1.0 / 0.9 / 1.0）→ topK
```

- **词表**：122 条领域条目，每条是「一组中文同义词 ↔ 一组英文同义词」（空洞↔void/cavity/delamination，探地雷达↔GPR，激光多普勒测振↔LDV…），中文按去空格子串匹配、英文按小写子串匹配，变体要显式列出；
- **第三路为什么没有启用**：扩展路已是「原查询 + 同义词」，纯译文路在评测中没有召回增量；`translatedQuery` 保留给二期语义召回。数字/缩写噪声改由扩展路的准入（覆盖率 + 余量）压制；
- **为什么用 RRF**：BM25 分数与语言、文档长度强相关，不可跨路比较，而名次可比；`k=10` 比常用的 60 更小，因为在个人库上只取 top-5，需要让头部名次差异更明显；
- **可解释**：每条命中带 `route`（词面 / 跨语言 / 两者），工具与面板都会显示，并给出「空洞→void、衬砌→lining 等 13 个」这样的扩展说明；
- **效果**：中文→英文 recall@5 0.07 → 0.79，同语言集不回退（0.92 → 0.92）；反向（英文→中文）0.17–0.25 → 0.50–0.67，MRR 仍偏低，列二期用语义召回解决。完整数据见 `evals/RESULTS.md`。

**索引降噪**（也在 `chunker.ts`）：文献标题行不进章节路径与正文；`ARTICLE INFO`/`ABSTRACT` 这类版面标签不作为章节；参考文献列表（过半行以 `[N]` 开头）整块丢弃 —— 7 篇共剔除 18 块，检索命中里不再出现「[29] J. Lee…」这类片段。

## 4. 失败分类

| 层 | 错误 kind | 用户看到什么 |
|---|---|---|
| Zotero | `unreachable` / `http` / `not-found` | 「连不上 Zotero 本地 API：确认已启动并打开『允许其他应用通信』」 |
| MinerU | `config` / `auth` / `quota` / `rate_limited` / `service_unavailable` / `parse_failed` / `network` | 各自的可操作提示（刷新 token / 明天再来 / 稍后重试 / 该 PDF 解析失败） |
| 索引 | 空检索 | 「文献库中没有相关内容」+ 列出「匹配元数据但未入库」的候选条目 |

原则：**不用别的来源拼凑**。MinerU 失败就是失败，工具结果里直接说失败原因。

## 5. 评测

| 指标 | 定义 | 谁产出 |
|---|---|---|
| `recall@5` | gold chunk 在 top-5 的题目比例 | `evals/run-eval.mjs`（无模型，可离线复现） |
| `MRR` | gold chunk 排名倒数均值 | 同上 |
| `hit_rate` | 至少返回一条片段的题目比例 | 同上 |
| `citation_accuracy` | 合法引用标记 / 全部引用标记 | grounded 生成器（插件内 `zotero_eval`） |
| `answer_rate` | 带 ≥1 个合法引用的回答比例 | 同上 |

评测集 `evals/qa-set.jsonl` 每题标注 `gold_chunk_id`（人工确认过的「答案所在片段」）。报告写在 `evals/reports/`，带 `git rev-parse --short HEAD` 与评测集 sha256。

## 6. 已知边界

- 不做 Zotero 写操作、不做多用户/鉴权、不做跨库检索；
- 不提供 MinerU 以外的解析方式（Zotero 自带全文只在诊断时用于对照）；
- 面板数据面无 Peer 身份（只能绑在 127.0.0.1 的 GUI 服务上），唯一写路径是保存 MinerU token；
- 界面文案目前只有中文；英文词典已注册但未接语言切换。
