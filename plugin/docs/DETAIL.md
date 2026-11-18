ZoteroSeek 把本地 Zotero 文献库接进 DeepSeek Harness：PDF 用 MinerU 解析成带版式的 Markdown，检索命中给出章节与页码，右侧边栏能直接读原文、勾选引用。

# 它能做什么

## 在对话里检索并带出处作答

插件给 Agent 注册 5 个工具：

| 工具 | 用途 |
|---|---|
| `zotero_search` | 检索已入库正文（词面 BM25 + 领域双语词表扩展，三路 RRF），返回带 `chunk_id`、章节路径、页码的片段；中文问题可命中英文文献 |
| `zotero_read` | 按 `chunk_id` 取回完整片段，或按 `item_key` 看整篇的章节结构 |
| `zotero_index` | 用 MinerU 解析某篇文献的 PDF 并入库（只读 Zotero） |
| `zotero_library` | 按标题/作者/标签查条目，拿到 `item_key` |
| `zotero_cite` | 生成 author-year / numeric / 参考文献行 / BibTeX |
| `zotero_eval` | 跑评测集，输出 recall@k / MRR / citation_accuracy / answer_rate 报告 |

插件还会往系统提示词里加一节引用规则：回答文献内容前必须先检索，引用写成 `[来源: chunk_id]`，且 `chunk_id` 只能原样取自检索结果。这样「有没有编造」是可事后核对的：chunk_id 在本机索引里是否存在、是否出现在本轮检索结果里，都能用脚本查。

## 在右侧边栏读原文、勾选引用

输入框左侧的「文献库」按钮打开侧边栏面板，三个视图：

- **文献**：Zotero 条目列表（可按标题/作者/标签筛选），未入库的点「入库」触发 MinerU 解析（约 20–60 秒/篇，命中缓存则秒回）；
- **阅读**：选中条目的 MinerU Markdown 原文 —— 标题层级、表格、公式、插图都在，可「在本篇检索」；
- **检索**：命中片段列表（可开关「跨语言检索」），每条显示命中路径（词面 / 跨语言 / 两者），勾选后一键复制行内引用、参考文献表或 BibTeX，或「引用到对话」。

# 前置条件

1. **Zotero 7+ 桌面版正在运行**，并在「设置 → 高级 → 允许此计算机上的其他应用程序与 Zotero 通信」中打开本地 API。
2. **MinerU API Token**（[mineru.net](https://mineru.net) 用户中心 → API 管理）。在面板右上角「⚙」里填入即可；它只保存在本机 `~/.zotero-seek/settings.json`，也可以通过环境变量 `MINERU_TOKEN` 提供。
3. 本插件只读 Zotero，不做任何写库操作。

# 数据与缓存

默认数据目录 `~/.zotero-seek`（可在插件配置的 `dataDir` 改）：

- `index.json`：文献条目 + 分块 + 检索索引（纯 JSON，可读可备份）；
- `parsed/<hash>/`：MinerU 解析产物，按「PDF 内容 sha1 + 解析参数」寻址，同一份 PDF 换条目不会重复花钱；
- `mineru-ledger.json`：MinerU 每日页数额度台账（MinerU 没有查询剩余配额的接口，只能本地记账）；
- `settings.json`：MinerU Token 与 Zotero 路径覆盖项。

# 已知限制

- 检索是「词面 BM25 + 领域双语词表扩展」，不是语义检索：同义改写、以及问题里缺少数值/枚举的「元问题」仍可能漏召回。中文→英文的实测 recall@5 为 0.79，反向（英文→中文）0.50–0.67，详见仓库 `evals/RESULTS.md`。
- 面板界面目前只有中文文案，英文词典已备好但未接界面语言切换。
- MinerU 解析需要外发你主动提交的那篇 PDF；解析失败时只报失败原因，不会用别的来源拼凑内容。
- 面板数据面是绑定在 127.0.0.1 GUI 服务上的私有 HTTP 路由，仅本机可访问；其中唯一的写入路径是保存 MinerU Token。
