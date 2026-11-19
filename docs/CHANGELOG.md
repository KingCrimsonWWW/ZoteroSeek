# 变更记录

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
