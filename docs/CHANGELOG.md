# 变更记录

## v0.3.8 — 2026-11-19

**检索成功率：口径、对照与提升**

- 新增**硬锚点路**（`src/core/query-anchors.ts`）：抽取问题中的缩写/型号、表图编号（中英互换）、
  引号术语单独检索一路，与两路 RRF；只对强锚点启用（纯数值不够）。留出集 hit@5 50%→62.5%，
  全量 53 题 79.2%→81.1%，MRR 0.5934→0.6013；
- 系统提示词与 `zotero_search` 描述补充：跨语言提问时建议在 `query_variants` 同时给出目标语言问法；
- 新增 4 个对照实验脚本（retrieval / anchors / variants / prf）与 `evals/RESULTS.md` 第 10 节，
  记录三项结论：锚点路（上线）、多问法（能力型，28 题 67.9%→92.9%）、词干与 PRF（试过不上线）；
- 单测 69 → 73；版本 0.3.7 → 0.3.8。

## v0.3.7 — 2026-11-19

- 「在 Zotero 打开」升级为**直接打开 PDF 并翻到命中页**：Host 端合并入库时保存的
  `pdfAttachmentKey`，构造 `zotero://open-pdf/library/items/<attachment>?page=N`；
  没有 PDF 附件时退回 `zotero://select/library/items/<item>`；
- 新增纯函数 `src/host/zotero-uri.ts` 与 4 个单测（有附件/无附件/页码越界/非法 key）；
- 命中卡 Z 按钮带上该片段所在页码；版本 0.3.6 → 0.3.7。

## v0.3.6 — 2026-11-19

- **「在 Zotero 打开」改为 Host 侧拉起**：渲染进程 `window.open('zotero://…')` 会被 Electron 拦掉
  （点了完全没反应），新增 `POST /api/open-zotero`，由 Host 调系统命令（Windows `cmd /c start`、
  macOS `open`、Linux `xdg-open`）打开 `zotero://select/library/items/<key>`；只接受合法 item_key，
  失败时把链接复制到剪贴板并提示；
- 命中卡的 `Z` 按钮移到**第一行**（与 chunk_id、相关度同一行），不再要求先展开；
- 版本 0.3.5 → 0.3.6。

## v0.3.5 — 2026-11-19

- 命中卡：chunk_id 与相关度同处第一行，进度条移到「第一行与标题之间」，标题、出处各占一行；
- **相关度改为相对本次结果集第一名的比例**（首条=100%）；此前除以「所有路都拿第一」的理论上限，
  最相关也只有 30–50%，看起来像坏了；
- 未入库文献点击后**只入库、不自动打开**：顶部显示「正在入库《…》已用 Ns」进度条，
  完成后命中卡徽标变「已入库」并提示「已入库，可点击打开」；
- 文献页新增「全部入库」按钮与批量进度（done/total）；
- 文献列表行、命中卡展开区、阅读页头部均新增「在 Zotero 打开」（`zotero://select/library/items/<key>`）；
- 页签文字居中、选中态改为品牌色淡底 + 内描边（恢复层次感，仍不依赖 border）；
- toast 从底部居中改到面板顶部（检索结果之上）；
- 版本 0.3.4 → 0.3.5。

## v0.3.4 — 2026-11-19

- 命中卡第一行放「相关度」，第二行标题、第三行出处（相关度不再挤占注释行）；
- 检索结果点未入库文献：自动触发 MinerU 入库（toast 提示「首次打开，正在自动入库…」），
  完成后直接进入阅读页，不再要求用户自己去找「入库」；
- 划词引用重做：按钮改为相对滚动容器绝对定位，滚动时自动收起；
  送输入框按 `insertQuote / quote / insertText / appendText / setText` 顺序探测宿主 InputActions，
  都不支持时复制到剪贴板并在 toast 里明确说明；
- 版本 0.3.3 → 0.3.4。

## v0.3.3 — 2026-11-19

- **字号与行距放大**：正文 13px / 行高 1.6–1.8、标题 13.5px、元信息 11px，并加 0.01em 字距；
- **命中卡标题独立成行**：徽标（类型/入库）与标题分离，中英文标题都从左边对齐，不再随徽标宽度错位；
- **页签改为 `role="tab"` 的 div**（不再用 `<button>`），彻底绕开宿主/UA 的默认边框与焦点环，
  同时保留键盘 Enter/Space 与 `aria-selected`；
- **返回记忆**：从检索结果进入阅读页，返回时回到「检索」而不是「文献」；
- **检索结果可点击**：新增 `GET /api/item?key=`，命中条目不在当前列表时按 key 取回再打开
  （中文/英文、已入库/未入库都可用）；
- **新增 UI 冒烟测试** `tests/ui-smoke.test.ts`：用 react-dom/server 渲染打包后的 Client bundle，
  断言页签角色、页签无 border/outline、aria-label、空状态动作与面板级 CSS（65 个单测）；
- 版本 0.3.2 → 0.3.3。

## v0.3.2 — 2026-11-19

**按 UI Skills（baseline-ui）重做面板视觉**

- 引入 `skills/baseline-ui`、`skills/improve-ui`（来自 ibelick/ui-skills，MIT），README 增加「界面设计基线」一节；
- 视觉统一：中性表面 + 1px 分隔线、单一强调色（品牌蓝）、4/8/12 间距、8px 卡片圆角；
- 命中卡：双徽标改为「彩色圆点 + 中性文字」，右侧相关度进度条，标题两行截断，正文两行截断（展开才放开）；
- 面板级 CSS：键盘 `:focus-visible` 描边、`::selection` 品牌色、`prefers-reduced-motion` 下关闭动效；
- 空状态：每处只给一句话 + 一个明确的下一步按钮（刷新 / 去文献页）；
- 图标按钮补 `aria-label`，toast 加 `role="status"`；
- 版本 0.3.1 → 0.3.2。

## v0.3.1 — 2026-11-19

**检索结果与阅读页改版（来自真实使用反馈）**

- 命中卡重做：左侧 3px **类型色条**（字面=蓝 / 扩展=橙 / 混合=紫）、类型与**入库状态双徽标**、
  融合分进度条、命中词**黄底高亮**；折叠态只显示命中处上下文（不再整页正文），
  展开后显示更长上下文并提供「打开原文」；
- 检索页去掉「跨语言扩展：…」与「扩展路准入：…」两行术语（这些信息保留在工具输出里），
  换成三个色点图例；新增「全选 / 清空」与勾选说明（勾选片段用于复制引用或引用到对话）；
- **阅读页划词引用**：选中正文后浮出「引用文本」按钮，自动定位到所在片段与页码
  （新增 `GET /api/locate`），输出 `> 原文` + 出处（书名/章节/页码/chunk_id），
  有 `inputActions.insertQuote` 时直接放进输入框，否则复制到剪贴板；
- 新增接口 `/api/locate`；版本 0.3.0 → 0.3.1。

## v0.3.0 — 2026-11-19

**检索算法升级（借鉴 dsh-zotero 的可信边界设计）**

- **matchKind 三态**：literal（词面命中）/ expanded（词表扩展命中）/ mixed（两路都命中）；
  工具输出、系统提示词与面板徽标三处一致，明确规定「扩展命中不得表述为原文措辞」，引用措辞前先 `zotero_read`；
- **扩展路校准准入**：`覆盖率 = 命中扩展词数 / 扩展词总数`，`minCoverage=0.4`、`margin=0.5`，
  由 `evals/calibrate-admission.mjs` 用 answer-removed 对照组标定；放行条数 18.0 → 2.2/题，检索指标不变；
- **query_variants**：`zotero_search` 新增参数，最多 4 条问法，每路独立打分、同一片段取最高分；
- **scoreNorm**：RRF 融合分归一化到 0–1（只表示排序强弱，不表示匹配置信度）；工具与面板同时展示逐路原始分；
- 标定报告 `evals/reports/admission-calibration.json` 记录了「分数绝对下限不可移植」的负结果；
- 单测 50 → 60；版本 0.2.6 → 0.3.0。

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
