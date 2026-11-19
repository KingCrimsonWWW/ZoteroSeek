# ZoteroSeek

**把本地 Zotero 文献库接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：MinerU 解析 PDF，检索带出处作答，侧边栏直接读原文并勾选引用。**

> 一个 DSH 插件（零第三方运行时依赖）：Zotero 是只读数据源，MinerU 是唯一 PDF 解析器，检索与引用校验都在本机进程内完成。

## 它解决什么问题

- 文献库在 Zotero 里，但「问答」类工具通常看不到你真正读过的那 170 篇 PDF；
- 直接丢 PDF 给模型会丢表格、公式和版面，问答里出现「看起来对但其实不对」的引用；
- 真正的科研问答需要**能核对出处**：这句话来自哪一篇、哪一节、第几页。

ZoteroSeek 的做法：用 MinerU 把 PDF 转成保版式的 Markdown → 按章节分块并保留页码 → 进程内 BM25 检索（叠加领域双语词表做跨语言扩展，三路 RRF 融合）→ 模型只能引用检索结果里的 `chunk_id` → 侧边栏能把原文和命中片段并排打开核对。

## 架构

```text
┌──────────────────────── DeepSeek Harness ────────────────────────┐
│  Client（浏览器）                     Host（Node）                 │
│  ┌──────────────────────┐            ┌─────────────────────────┐  │
│  │ 右侧边栏「文献库」面板 │  HTTP      │ 6 个 Agent 工具          │  │
│  │ 文献 / 阅读 / 检索     │◄──────────►│ zotero_search/read/      │  │
│  │ 勾选 → 引用到对话      │ /zotero-  │ index/library/cite/eval │  │
│  └──────────────────────┘ seek/*     │ 引用规则注入系统提示词   │  │
│                                      └───────────┬─────────────┘  │
│                                                  │ Runtime          │
│                    ┌─────────────────────────────▼──────────────┐ │
│                    │ 检索：词面 BM25 + 双语词表扩展 + 纯译文 三路  │ │
│                    │       （标题×3/章节×2/正文×1，RRF 融合）      │ │
│                    │ 解析：MinerU 云端 → 内容寻址缓存 + 配额台账   │ │
│                    │ Zotero：本地 API（只读）+ storage PDF 路径    │ │
│                    └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
             │ Zotero 本地 API 127.0.0.1:23119        │ MinerU 云 API
        Zotero 7+（文献元数据 / PDF）            mineru.net（PDF → Markdown）
```

关键设计决策（以及为什么）：

| 决策 | 取舍 |
|---|---|
| **单个 TypeScript 插件，无 sidecar** | Zotero 与 MinerU 都是 HTTP API，检索用进程内 BM25，作答复用宿主 Agent；少两套运行时与端口，MVP 从 8 天压到 2–3 天 |
| **BM25 + 中文二元 bigram** | 几百篇/几千分块的规模下毫秒级、零模型下载、可解释（能报出命中了哪些词）；语义检索留作二期 |
| **跨语言靠领域词表 + 三路 RRF** | 中文问英文文献 recall@5 0.07→0.79，无需下载 embedding 模型；代价是反向（英文→中文）依赖词表覆盖，已实测并列入二期 |
| **MinerU `content_list.json` 为主分块源** | 字段有官方口径、带 `page_idx` 与 `bbox`；`content_list_v2.json` 作为可选增强，`full.md` 作为兜底 |
| **内容寻址的解析缓存** | 目录名 = `sha1(pdf 字节 + 解析参数)`，同一份 PDF 换条目/改标题不会重复花钱 |
| **引用写成 `[来源: chunk_id]`** | chunk_id 由索引生成、全库唯一；事后可用脚本核对「引用的片段是否真实存在、是否在本轮检索结果里」 |
| **面板数据走本机 HTTP 路由** | 不依赖 DSH 的类型化 Remote 生成器；代价是路由只绑定 127.0.0.1，且只做只读 + token 保存 |

## 文档地图

| 文档 | 内容 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层、三条数据流、分块与检索（含跨语言三路 + RRF）、失败分类、评测口径 |
| [docs/DEMO.md](docs/DEMO.md) | 5 分钟演示脚本与常见追问 |
| [docs/INTERVIEW.md](docs/INTERVIEW.md) | 简历 bullet、面试问答、已知短板与改进计划 |
| [evals/RESULTS.md](evals/RESULTS.md) | 全部评测数字、失败样本、局限与诚实说明 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 版本变更记录 |
| [docs/research/](docs/research/) | DSH Host/Client 插件 API、MinerU、Zotero 的实测调研笔记（施工级） |
| [plugin/docs/DETAIL.md](plugin/docs/DETAIL.md) | 插件管理器里展示的功能说明与限制 |

## 快速开始

```powershell
# 1. 装依赖并构建（产物在 plugin/，是可安装的 bundle）
npm install
npm run build

# 2. 装进当前 DSH profile（或：插件管理器 → 添加插件 → 本地目录 E:\TheCode\ZoteroSeek\plugin）
#    这里用 DSH 的 plugin_manager 工具安装，命令行等价于：
#    dsh plugin --profile desktop add link:E:\TheCode\ZoteroSeek\plugin

# 3. 自检：Zotero 连通性、MinerU token、索引规模
node evals/doctor.mjs

# 4. 入库几篇文献（也可在面板里点「入库」）
node evals/ingest.mjs EHC5UR3B I2TFV3AV UITJGJM9

# 5. 检索侧评测（不调用模型）
node evals/run-eval.mjs
```

前提：

1. **Zotero 7+ 运行中**，且「设置 → 高级 → 允许此计算机上的其他应用程序与 Zotero 通信」已打开；
2. **MinerU token**：在面板右上角 ⚙ 填入（存本机 `~/.zotero-seek/settings.json`），或用环境变量 `MINERU_TOKEN`；
3. 插件只读 Zotero，不做任何写库操作。

## 使用

- **在对话里问**：「我文献库里关于衬砌背后空洞的检测方法有哪些？分别有什么局限？」→ Agent 先调 `zotero_search`，再基于带页码的片段作答，引用形如 `[来源: EHC5UR3B:0012]`。
- **用中文问英文文献**：检索默认开启跨语言扩展（面板里可关闭做对照）。例如问「轨道板脱空 激光多普勒测振 检测」，会先把「脱空/轨道板/激光多普勒」扩展成 `void / cavity / track slab / laser doppler vibrometry` 再检索；工具输出里会写明扩展了哪些词、每条命中是「词面」「跨语言」还是两者都中。
- **在侧边栏核对**：点输入框左侧的 ZS 图标按钮 → 打开右侧边栏「ZoteroSeek」面板。三个页签随时可切换：文献（元数据筛选，支持中文查英文条目，未入库的点「入库」）→ 阅读（MinerU Markdown 原文）→ 检索（跨语言开关、检索历史、勾选片段 → 引用到对话 / 复制引用 / BibTeX）。
- **没入库的文献**：面板里点「入库」，或让 Agent 调 `zotero_index`。

## 评测

检索侧（不需要模型，可复现）：`node evals/run-eval.mjs --qa <集> --mode hybrid|lexical`

| 指标 | 口径 |
|---|---|
| `recall@5` | gold chunk 出现在 top-5 的题目比例 |
| `MRR` | gold chunk 排名倒数均值 |
| `hit_rate` | 至少返回一条片段的题目比例 |

生成侧（`citation_accuracy` / `answer_rate`）由插件内的 grounded 生成器产出：答案里的每个 `[^N^]` 都必须落在本轮检索编号内，不合法先纠正重试一次、再失败就剥离标记，绝不留假引用。

最近一次结果（7 篇 / 234 分块，`deepseek-flash`）：

| 评测集 | 纯词面 recall@5 | 混合 recall@5 | citation_accuracy | answer_rate |
|---|---|---|---|---|
| 同语言 25 题 | 0.92 | **0.92** | **1.00** | **1.00** |
| 中文→英文 14 题 | 0.07 | **0.79** | **1.00** | **1.00** |
| 英文→中文 留出 8+6 题 | 0.25 / 0.17 | **0.50 / 0.67** | — | — |

原始报告、失败样本与局限说明见 [evals/RESULTS.md](evals/RESULTS.md)，随每次改动重新生成。

## 目录结构

```text
src/core/         纯 TS 领域层，可 node --test 直接单测
  zotero.ts       Zotero 本地 API 客户端（只读）
  mineru.ts       MinerU 云端解析客户端（四步流程 + 内容寻址缓存 + 配额台账）
  zip.ts          零依赖 ZIP 读取器
  chunker.ts      content_list / full.md → 带章节与页码的 chunk（标题/参考文献降噪）
  bm25.ts         中文 bigram 分词 + BM25
  glossary.ts     领域双语词表（122 条）→ 查询扩展（zh↔en）
  rrf.ts          Reciprocal Rank Fusion
  library.ts      索引持久化、增量入库、三路检索入口
  grounding.ts    grounded 提示词 + 引用解析/校验/剥离
  eval.ts         检索 + 引用指标（评测单一实现）
  cite.ts         作者-年份 / 参考文献 / BibTeX 格式化
src/host/         DSH Host 半边：Runtime、6 个工具、/zotero-seek 路由、提示词注入
src/client/       DSH Client 半边：右侧边栏面板 + 输入框入口按钮
plugin/           可安装 bundle（构建产物，提交进仓库）
evals/            doctor / ingest / run-eval / sample-chunks + 4 份评测集 + RESULTS.md
tests/            node --test 单测（41 个）
docs/             架构说明、演示脚本、面试讲解、调研笔记
```

## 已知限制

- 检索是**词面 + 领域词表**的方法：同义改写、以及「问题里缺少数值/枚举」的元问题仍会漏召回；二期用多语 embedding 做语义召回并与现有三路 RRF 融合。
- 反向跨语言（英文问中文文献）依赖词表覆盖度，实测 recall@5 0.17–0.25 → 0.50–0.67，MRR 仍偏低。
- 面板界面只有中文文案，英文词典已备好但未接语言切换。
- MinerU 解析需要外发你主动提交的那一篇 PDF；解析失败只报原因，不用其它来源拼凑内容。
- 面板数据面是绑定 127.0.0.1 的私有 HTTP 路由（无 Peer 身份），只做只读与 token 保存。

## License

[AGPL-3.0](./LICENSE)
