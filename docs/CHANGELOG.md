# 变更记录

## v0.2.6 — 2026-11-19

**阅读页换渲染引擎：markdown-it + KaTeX**

- 用 markdown-it 替换自写的轻量渲染器：标题/列表/表格（管道表 + MinerU 的 HTML 表）/代码块/
  链接/图片/引用全部按 CommonMark 规则渲染；图片路径统一改写为 `/zotero-seek/file` 路由；
- 公式交给 KaTeX：`$$…$$` → display 模式，`$…$` → inline 模式（`math-render.ts` 可单测），
  坏公式不抛异常；`\tag{}` 编号保留；货币符号（`$5`）不会被误判成公式；
- KaTeX 样式用 esbuild 的 text loader 内联、去掉 `@font-face`（字体文件不进包，回落到系统数学字体）；
- 正文改为 `dangerouslySetInnerHTML` 渲染，同时保留脚本/iframe/内联事件的消毒；
- **页签样式重写**：去掉 `border`，选中态用「品牌色淡底 + inset 描边」，修掉深色主题下
  页签出现白框的问题；
- 依赖说明：`markdown-it` 与 `katex` 在构建时打进 `plugin/client.js`（约 750 KB），
  插件安装后仍然没有任何运行时依赖；
- 单测 44 → 50（新增公式预渲染 6 个）；版本 0.2.5 → 0.2.6。

## v0.2.5 — 2026-11-19

**检索纳入 Zotero 元数据（标签/摘要/关键词/DOI 也参与检索）**

- 索引新增「元数据块」：每个条目一块 `<itemKey>:meta`，文本含标题、作者、年份、出版物、
  标签、摘要、extra（关键词/分区常写在这里）、DOI、citationKey；BM25 一并检索；
- 未入库条目也有元数据块，因此「搜标签就能找到那篇论文」，命中会标注「元数据·未入库」并提示去入库；
- 旧索引打开时自动补齐元数据块并落盘（无需重新解析）；
- 工具输出区分「来源=元数据」与正文片段，并提示未入库条目需要 `zotero_index`；
- 面板状态栏与 `/api/status` 增加元数据块计数。

**面板**

- 删除「跨语言检索」开关：跨语言是一等能力，始终开启，只在有扩展时显示扩展说明；
- 文献页与检索页**共享检索历史**（本机 localStorage），文献页点历史即按该词筛选；
- 修复页签焦点框：选中的页签用品牌色底 + 描边，未选中的不再显示系统焦点框；
- 阅读页公式渲染：新增 LaTeX → 可读文本转换（希腊字母/运算符/`\frac`/`\sqrt`/上下标/`\tag`），
  显示为公式卡片，悬停可看原始 LaTeX；行内公式同样转换，`<sup>`/`<sub>` 按上下标渲染；
- 版本号 0.2.4 → 0.2.5。

## v0.2.4 — 2026-11-19

**面板可用性修复（来自真实使用反馈）**

- 「阅读 / 检索」两个页签不再置灰：任何页签都能点开，空状态给出明确引导
  （阅读：先选一篇已入库文献；检索：输入问题或点历史记录）；
- 检索页新增**历史检索**：本机 localStorage 保存最近 10 条（可点选重跑、可清除）；
- 文献页新增说明行：这里只筛元数据（标题/作者/标签），正文检索在「检索」页；
- **文献页支持中文查英文条目**：元数据字面匹配为空时，用领域双语词表把查询词扩展成英文再匹配
  （实测「空洞病害」能命中 *Dynamic load factor of concrete defects…*），仍为空才退回 Zotero 检索；
- 面板头部加上 ZS 图标；右侧边栏页签标题由「文献库」改为 **ZoteroSeek**（入口按钮 tooltip 保留「ZoteroSeek 文献库」）；
- 版本号 0.2.3 → 0.2.4。

## v0.2.3 — 2026-11-19

- 输入框左侧入口按钮改为**纯图标**：去掉「📚 文献库」文字，直接显示 ZS 图标（16×16），
  文字退到 `title` / `aria-label` 提示里；
- 图标以 64×64 PNG 经 esbuild `dataurl` loader 内联进 Client bundle（+4 KB，不发额外请求），
  源图仍由 `src/client/assets/zs-icon.png` 派生；
- 版本号 0.2.2 → 0.2.3。

## v0.2.2 — 2026-11-19

- 插件图标换成仓库里的 ZS 标识（红色 Z / 蓝色 S）。源图 1254×1254 / 833 KB 超出插件 256 KiB 上限，
  用 Pillow 压到 512×512 RGB PNG（约 170 KB）；源图留在仓库根目录不提交（`.gitignore` 的 `/icon.png`），
  历史里也能从提交 `5dcfa5a` 之前的版本取回；
- `plugin/package.json` 的 `./icon` 导出与 `files` 由 `icon.svg` 改为 `icon.png`，删除旧的 SVG；
- 版本号 0.2.1 → 0.2.2（工作区与 bundle 同步）。

## v0.2.0 — 2026-11-18

**跨语言检索（核心特性）**

- 新增 `core/glossary.ts`：122 条隧道/无损检测/GPR/声学/机器学习领域双语词条，支持 zh↔en 双向查询扩展；
- 新增 `core/rrf.ts`：Reciprocal Rank Fusion（k=10），合并多路召回排名；
- `Library.search` 升级为三路检索：词面 BM25 / 原文+扩展词 / 纯译文，RRF 融合；`searchDetailed` 返回扩展解释；
- 检索命中新增 `route`（词面 / 跨语言 / 两者）与 `matched` 字段，工具与面板都会展示扩展了哪些词；
- 面板检索页新增「跨语言检索」开关与扩展提示，命中卡显示命中路径；
- 新增评测集：`qa-set-cross.jsonl`（中文→英文 14 题）、`qa-set-holdout*.jsonl`（英文→中文 8+6 题）；
- 评测脚本支持 `--mode hybrid|lexical`；`zotero_eval` 工具支持 `mode` 参数；
- 结果：中文→英文 recall@5 0.0714 → 0.7857，同语言集 0.92 无回退（详见 `evals/RESULTS.md`）。

**检索质量**

- 分块降噪：文献标题行不进章节路径/正文；`ARTICLE INFO`、`ABSTRACT` 等版面标签不作为章节；**参考文献列表整块丢弃**（7 篇剔除 18 块）；
- 标题层级改为按标题编号推断（MinerU vlm 后端会把所有标题压成同一级）。

**健壮性**

- MinerU 轮询（GET，免费幂等）与结果下载加退避重试；创建任务的 POST 不重试（避免重复计费）；
- 索引文件损坏时先备份为 `index.json.broken-<ts>` 再以空索引启动，不再静默清空；
- 演示脚本 `scripts/demo.ps1`：一条命令跑完自检 + 词面/跨语言对照评测。

**工程质量**

- 单测从 22 个增至 41 个（新增词表、RRF、混合检索集成、评测指标计算、三路召回覆盖）；
- 新增 `zotero_eval` 工具：走 DSH llm 服务跑生成侧评测（citation_accuracy / answer_rate），报告落数据目录；
- 新增 `docs/INTERVIEW.md`（简历 bullet + 面试问答）、`docs/CHANGELOG.md`；
- 面板在深色主题下修正主色按钮文字颜色（改用 `--dsw-alias-bg-base` 自动反色）。

## v0.1.0 — 2026-11-18（MVP）

- Zotero 本地 API 只读客户端、storage PDF 路径解析（含 `links:null` 兜底）；
- MinerU 云端四步解析客户端：内容寻址缓存 + 配额台账 + 稳定错误分类；
- 零依赖 ZIP 读取器（node:zlib）；
- 章节感知分块（表格/公式原子块、页码、章节路径）、中文 bigram BM25（字段加权）；
- 5 个 Agent 工具（search / read / index / library / cite）+ 系统提示词引用契约；
- 右侧边栏面板：文献列表 / MinerU Markdown 阅读 / 检索命中勾选引用，输入框入口按钮；
- `/zotero-seek` 面板 HTTP 路由（status / library / search / markdown / chunk / cite / index / file）；
- grounded 生成器与引用校验（`[^N^]`。
- 22 个单测、doctor / ingest / run-eval 脚本、评测集 25 题与首份报告。
