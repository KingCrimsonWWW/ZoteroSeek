/**
 * ZoteroSeek 的领域模型。这里刻意不依赖任何 DSH / Electron API，
 * 所以可以被 node --test 直接单测，也方便以后换宿主。
 */

/** 一条 Zotero 文献（只读快照，来自本地 API）。 */
export interface ZoteroItem {
  /** Zotero item key，8 位大写字母数字，全库唯一。 */
  key: string
  itemType: string
  title: string
  /** 规范化的作者名："Liang, Shichuan"，中文名形如 "王, 浩东"。 */
  creators: string[]
  /** 优先取 parsedDate 的年份，其次从 date 字段里抠 4 位年份。 */
  year: number | null
  date: string | null
  doi: string | null
  /** Zotero 的 citationKey（Better BibTeX 写入的字段），可能没有。 */
  citationKey: string | null
  publicationTitle: string | null
  abstractNote: string | null
  /** Zotero 的 extra 字段（期刊分区、关键词等常写在这里）。 */
  extra: string | null
  tags: string[]
  /** 所属合集 key 列表。 */
  collections: string[]
  /** 首个 PDF 附件的 key；没有 PDF 时为 null。 */
  pdfAttachmentKey: string | null
  /** PDF 在磁盘上的绝对路径；解析不到时为 null。 */
  pdfPath: string | null
}

/** 一个 Zotero 合集（分类）。 */
export interface ZoteroCollection {
  key: string
  name: string
  parentKey: string | null
  itemCount: number
}

/** 解析产物里出现的块类型（MinerU content_list 的 type 字段超集）。 */
export type BlockKind = 'text' | 'title' | 'table' | 'equation' | 'image' | 'list' | 'code' | 'other'

/** MinerU 解析出的一个内容块（已归一化，v1/v2 都用这个形状）。 */
export interface ContentBlock {
  kind: BlockKind
  /** 块文本；表格是 HTML，公式是 LaTeX（自带 $ 或 $$）。 */
  text: string
  /** 0 起的页序号；未知为 null。 */
  page: number | null
  /** 标题层级 1-6；非标题为 null。 */
  headingLevel: number | null
  /** 图片相对路径（相对解析目录），非图片为 null。 */
  imagePath: string | null
}

/** 分块来源：MinerU 解析出的正文 / 由 Zotero 元数据合成的条目摘要。 */
export type ChunkSource = 'body' | 'meta'

/** 一个可检索的分块。 */
export interface Chunk {
  /** 正文块 `<itemKey>:<seq:04d>`；元数据块 `<itemKey>:meta`。 */
  chunkId: string
  itemKey: string
  /** 文献标题，冗余存一份，检索结果不必再查条目表。 */
  title: string
  /** 章节路径，例如 "3 Methods > 3.2 Void detection"；未知为空串。 */
  sectionPath: string
  /** 块首所在页（1 起）；未知为 null。 */
  page: number | null
  /** 主类型：正文 / 表格 / 公式 / 图注。 */
  kind: 'text' | 'table' | 'equation' | 'figure'
  text: string
  /** 粗略 token 估算（中文按字、英文按 4 字符≈1 token）。 */
  tokenEstimate: number
  /** 来源；缺省视为正文（兼容旧索引）。 */
  source?: ChunkSource
}

/** 检索命中的来源：原始词面 / 跨语言扩展 / 两路都命中。 */
export type HitRoute = 'lexical' | 'expanded' | 'both'

/**
 * 命中类型（对模型与用户的公开口径）。
 * - literal：查询词本身出现在片段里；
 * - expanded：只有词表扩展出的等价词命中（不得当作原文措辞引用）；
 * - mixed：两路都命中。
 */
export type MatchKind = 'literal' | 'expanded' | 'mixed'

/** 一次检索命中。 */
export interface SearchHit {
  chunkId: string
  itemKey: string
  title: string
  sectionPath: string
  page: number | null
  kind: Chunk['kind']
  text: string
  /** 融合后的分数（RRF；单路时等价于该路名次分）。 */
  score: number
  /** 这一条是怎么被找到的。 */
  route: HitRoute
  /** 命中的查询词（含扩展词），用于解释与调参。 */
  matched: string[]
  /** 命中类型：字面 / 扩展 / 混合（扩展命中不得表述为原文措辞）。 */
  matchKind: MatchKind
  /** 词面路原始 BM25 分；未参与词面路时为 0。 */
  lexicalScore: number
  /** 扩展路原始 BM25 分；未过准入或未命中时为 0。 */
  expandedScore: number
  /** RRF 融合分的归一化值（0–1，仅用于排序展示，不代表匹配强度）。 */
  scoreNorm: number
  /** 命中来自正文片段还是条目元数据。 */
  source: ChunkSource
  /** 该条目是否已入库（未入库的元数据命中不可引用正文）。 */
  indexed: boolean
}

/** 一篇文献的解析状态。 */
export interface ParsedDocument {
  itemKey: string
  /** 解析产物目录（绝对路径）。 */
  dir: string
  /** 文件名 → 绝对路径的映射（full.md / content_list_v2.json / images/*）。 */
  markdownPath: string
  pageCount: number | null
  parsedAt: string
  /** 产生该结果的内容指纹（sha1 + 解析参数）。 */
  fingerprint: string
}

/** 索引文件（整库快照，JSON 落盘，进程内建 BM25）。 */
export interface LibraryIndex {
  version: 1
  builtAt: string
  /** 解析参数指纹，参数变了索引要重建。 */
  settingsFingerprint: string
  items: ZoteroItem[]
  /** 已解析文献的元信息，key 是 itemKey。 */
  parsed: Record<string, ParsedDocument>
  chunks: Chunk[]
}

/** 工具层统一返回：成功带 value，失败带可读原因与稳定 code。 */
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string }
