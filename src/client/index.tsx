/**
 * ZoteroSeek 的 Client 半边：右侧边栏里的「文献库」面板。
 *
 * 三个视图，都在同一个 tab 里：
 *  - 文献：Zotero 条目列表 + 入库（MinerU 解析）；
 *  - 阅读：选中条目的 MinerU Markdown 原文（标题/表格/公式/插图），可「在本篇内检索」；
 *  - 检索：BM25 命中的片段，勾选后批量复制行内引用或参考文献。
 *
 * 数据面走 Host 注册的 `/zotero-seek/*` HTTP 路由（见 src/host/server.ts）；
 * 面板不 import 任何 DSH 包，React 由模块表提供。
 */
import { createElement as h, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import zsIcon from './assets/zs-icon.png'
import { createMarkdownRenderer, KATEX_CSS, MARKDOWN_CSS } from './markdown.ts'
import type { CSSProperties, ReactNode } from 'react'

// ------------------------------------------------------------------ 类型

interface SlotOptions {
  name: string
  key?: string
  id?: string
  order?: number
  inject?: () => Record<string, unknown>
}

interface ClientContextLike {
  slots: {
    inject(key: string, callback: () => (() => void) | void): () => void
    register(options: SlotOptions, component: (props: any) => ReactNode): () => void
  }
  sidebarRight: { openTab(kind: string, options?: Record<string, unknown>): void }
  sidebarRightTabs: { register(definition: Record<string, unknown>): () => void }
  locale: {
    register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
    bind(namespace: string): (key: string, params?: Record<string, string>) => string
  }
  effect(callback: () => () => void, label?: string): unknown
}

interface ApiResult<T> {
  ok: boolean
  value?: T
  code?: string
  message?: string
}

interface ItemView {
  key: string
  title: string
  year: number | null
  creators: string[]
  publicationTitle: string | null
  tags: string[]
  parsed: boolean
}

interface HitView {
  chunkId: string
  itemKey: string
  title: string
  sectionPath: string
  page: number | null
  kind: string
  text: string
  score: number
  /** lexical / expanded / both：这条是怎么被找到的。 */
  route?: 'lexical' | 'expanded' | 'both'
  /** 命中类型：字面 / 扩展 / 混合（扩展命中不得表述为原文措辞）。 */
  matchKind?: 'literal' | 'expanded' | 'mixed'
  /** RRF 融合分的归一化值（0–1，仅用于展示排序强弱）。 */
  scoreNorm?: number
  /** 词面路 / 扩展路的原始分。 */
  lexicalScore?: number
  expandedScore?: number
  /** body = MinerU 正文块；meta = 条目元数据块。 */
  source?: 'body' | 'meta'
  /** 该条目是否已入库（元数据命中可能来自未入库条目）。 */
  indexed?: boolean
}

interface MarkdownView {
  item: ItemView
  markdown: string
  parsed: { dir: string; parsedAt: string; pageCount: number | null } | null
  chunks: Array<{ chunkId: string; sectionPath: string; page: number | null; kind: string; tokens: number }>
  images: string[]
}

interface StatusView {
  dataDir: string
  zotero: { reachable: boolean; message: string }
  mineru: { configured: boolean; tokenSource: string; todayPages: number; tokenValid: boolean | null; tokenMessage: string }
  library: { items: number; parsedItems: number; chunks: number; builtAt: string | null }
}

// ------------------------------------------------------------------ 词典

const DICT = {
  zh: {
    appName: 'ZoteroSeek',
    title: '文献库',
    tabLibrary: '文献',
    tabReader: '阅读',
    tabHits: '检索',
    refresh: '刷新',
    settings: '设置',
    back: '返回',
    searchPlaceholder: '按标题/作者/标签筛选…',
    search: '筛选',
    libraryHint: '只筛文献元数据（标题/作者/标签，中文可查英文条目）；正文检索请到「检索」页',
    queryPlaceholder: '在已入库正文里检索（中英文均可）…',
    runSearch: '检索',
    history: '历史检索',
    clearHistory: '清除',
    noHistory: '还没有检索记录',
    searchEmpty: '输入问题后回车开始检索',
    readerEmpty: '先从「文献」列表里选一篇已入库的文献',
    noIndexedHint: '还没有任何文献入库：点条目右侧「入库」，或让 Agent 调 zotero_index',
    index: '入库',
    indexing: 'MinerU 解析中…',
    indexHint: '未入库，点「入库」用 MinerU 解析成 Markdown',
    noItems: '没有条目。先点右上角「刷新」从 Zotero 拉取。',
    kindLiteral: '字面',
    kindExpanded: '扩展',
    kindMixed: '字面+扩展',
    kindExpandedHint: '扩展命中：只有词表扩展出的等价词在文中出现，引用措辞前请打开原文核对',
    searchLegend: '匹配类型：字面=查询词出现在原文；扩展=词表扩展词命中（不等同原文措辞）；字面+扩展=两路都命中',
    noHits: '没有命中。可以先切换到「文献」，把相关文献入库再试。',
    hitsFor: '命中片段',
    selected: '已选',
    copyCitation: '复制行内引用',
    copyReference: '复制参考文献',
    copyBibtex: '复制 BibTeX',
    copied: '已复制',
    copyFailed: '复制失败（浏览器剪贴板不可用）',
    parsedAt: '解析于',
    chunks: '分块',
    pages: '页',
    inThisDoc: '在本篇检索',
    notParsed: '这篇还没有入库',
    mineruToken: 'MinerU Token',
    mineruTokenHint: '在 mineru.net 用户中心 → API 管理获取；只保存在本机 ~/.zotero-seek/settings.json',
    zoteroStorage: 'Zotero storage 目录（可选）',
    save: '保存',
    saved: '已保存',
    close: '关闭',
    status: '状态',
    zoteroOk: 'Zotero 已连接',
    zoteroDown: 'Zotero 未连接',
    mineruMissing: '未配置 MinerU Token',
    indexOk: '已入库',
    unindexed: '未入库',
    loading: '加载中…',
    cancel: '取消',
    retry: '重试',
  },
  en: {
    appName: 'ZoteroSeek',
    title: 'Library',
    tabLibrary: 'Library',
    tabReader: 'Reader',
    tabHits: 'Search',
    refresh: 'Refresh',
    settings: 'Settings',
    back: 'Back',
    searchPlaceholder: 'Filter by title, author or tag…',
    search: 'Filter',
    libraryHint: 'Filters metadata only (title / author / tag); full-text search lives in the Search tab',
    queryPlaceholder: 'Search the indexed full text…',
    runSearch: 'Search',
    history: 'Recent searches',
    clearHistory: 'Clear',
    noHistory: 'No searches yet',
    searchEmpty: 'Type a question and press Enter',
    readerEmpty: 'Pick an indexed paper from the Library tab first',
    noIndexedHint: 'Nothing is indexed yet: press Parse on an item, or call zotero_index from the agent',
    index: 'Parse',
    indexing: 'MinerU parsing…',
    indexHint: 'Not indexed yet — Parse turns the PDF into Markdown',
    noItems: 'No items. Use Refresh to load them from Zotero.',
    kindLiteral: 'literal',
    kindExpanded: 'expanded',
    kindMixed: 'mixed',
    kindExpandedHint: 'Expanded hit: only a glossary synonym matched — verify the wording in the source before quoting',
    searchLegend: 'Match type: literal = query words appear in the text; expanded = glossary synonym match (not the source wording); mixed = both routes hit',
    noHits: 'No hits. Switch to Library and index the relevant papers first.',
    hitsFor: 'Passages',
    selected: 'selected',
    copyCitation: 'Copy citation',
    copyReference: 'Copy references',
    copyBibtex: 'Copy BibTeX',
    copied: 'Copied',
    copyFailed: 'Clipboard unavailable',
    parsedAt: 'Parsed',
    chunks: 'chunks',
    pages: 'pages',
    inThisDoc: 'Search this paper',
    notParsed: 'Not parsed yet',
    mineruToken: 'MinerU token',
    mineruTokenHint: 'From mineru.net → API. Stored locally in ~/.zotero-seek/settings.json',
    zoteroStorage: 'Zotero storage dir (optional)',
    save: 'Save',
    saved: 'Saved',
    close: 'Close',
    status: 'Status',
    zoteroOk: 'Zotero connected',
    zoteroDown: 'Zotero unreachable',
    mineruMissing: 'MinerU token missing',
    indexOk: 'Indexed',
    unindexed: 'Unindexed',
    loading: 'Loading…',
    cancel: 'Cancel',
    retry: 'Retry',
  },
} as const

type Dict = typeof DICT.zh

// ------------------------------------------------------------------ 面板

const TAB_ID = 'zotero-seek/panel'
const TAB_KIND = 'zotero-seek'

interface PanelProps {
  sessionId?: string
  inputActions?: { insertQuote?: (text: string, summary?: string) => void }
}

function createPanel(t: Dict) {
  return function ZoteroSeekPanel(props: PanelProps): ReactNode {
    const [view, setView] = useState<'library' | 'reader' | 'hits'>('library')
    const [items, setItems] = useState<ItemView[]>([])
    const [filter, setFilter] = useState('')
    const [selected, setSelected] = useState<ItemView | null>(null)
    const [doc, setDoc] = useState<MarkdownView | null>(null)
    const [query, setQuery] = useState('')
    const [hits, setHits] = useState<HitView[]>([])
    const [hasSearched, setHasSearched] = useState(false)
    const [history, setHistory] = useState<string[]>(() => loadSearchHistory())
    const [expansionHint, setExpansionHint] = useState('')
    const [admission, setAdmission] = useState<{ minCoverage: number; margin: number; candidates: number; admitted: number } | null>(null)
    const [checked, setChecked] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState<string>('')
    const [toast, setToast] = useState<string>('')
    const [error, setError] = useState<string>('')
    const [status, setStatus] = useState<StatusView | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [tokenDraft, setTokenDraft] = useState('')
    const [storageDraft, setStorageDraft] = useState('')
    const scrollRef = useRef<HTMLDivElement | null>(null)

    const loadStatus = useCallback(async () => {
      const result = await apiGet<StatusView>('/api/status')
      if (result.ok && result.value !== undefined) setStatus(result.value)
    }, [])

    const loadItems = useCallback(async (keyword: string) => {
      setError('')
      const result = await apiGet<ItemView[]>('/api/library', { query: keyword, limit: '120' })
      if (result.ok && result.value !== undefined) setItems(result.value)
      else setError(result.message ?? '加载条目失败')
    }, [])

    useEffect(() => {
      void loadStatus()
      void loadItems('')
    }, [loadStatus, loadItems])

    const openDoc = useCallback(async (item: ItemView) => {
      setSelected(item)
      setDoc(null)
      setView('reader')
      const result = await apiGet<MarkdownView>('/api/markdown', { item_key: item.key })
      if (result.ok && result.value !== undefined) setDoc(result.value)
      else setError(result.message ?? '加载原文失败')
    }, [])

    const runIndex = useCallback(async (item: ItemView) => {
      setBusy(item.key)
      setError('')
      try {
        const result = await apiPost<{ chunks: number; source: string; cached: boolean }>('/api/index', { item_key: item.key })
        if (result.ok && result.value !== undefined) {
          setToast(`已入库 ${item.title.slice(0, 40)} · ${result.value.chunks} 个分块`)
          await loadItems(filter)
          await loadStatus()
          if (selected?.key === item.key) await openDoc({ ...item, parsed: true })
        } else {
          setError(result.message ?? '入库失败')
        }
      } finally {
        setBusy('')
      }
    }, [filter, loadItems, loadStatus, openDoc, selected])

    const rememberQuery = useCallback((keyword: string) => {
      setHistory((current) => {
        const next = [keyword, ...current.filter((entry) => entry !== keyword)].slice(0, 10)
        saveSearchHistory(next)
        return next
      })
    }, [])

    const clearHistory = useCallback(() => {
      setHistory([])
      saveSearchHistory([])
    }, [])

    const runSearch = useCallback(async (keyword: string, itemKey?: string) => {
      setBusy('search')
      setError('')
      setHasSearched(true)
      try {
        const result = await apiGet<{ hits: HitView[]; note?: string; expansion?: { description: string } | null; admission?: { minCoverage: number; margin: number; candidates: number; admitted: number } | null }>('/api/search', {
          q: keyword,
          ...(itemKey === undefined ? {} : { item_key: itemKey }),
        })
        if (result.ok && result.value !== undefined) {
          setHits(result.value.hits)
          setExpansionHint(result.value.expansion?.description ?? '')
          setAdmission(result.value.admission ?? null)
          if (itemKey === undefined) rememberQuery(keyword)
          if (result.value.hits.length === 0) setError(result.value.note ?? t.noHits)
        } else {
          setError(result.message ?? '检索失败')
        }
        setView('hits')
      } finally {
        setBusy('')
      }
    }, [rememberQuery, t.noHits])

    const toggle = useCallback((chunkId: string) => {
      setChecked((current) => {
        const next = new Set(current)
        if (next.has(chunkId)) next.delete(chunkId)
        else next.add(chunkId)
        return next
      })
    }, [])

    const copyCitations = useCallback(async (format: 'author-year' | 'reference' | 'bibtex') => {
      const keys = [...new Set(hits.filter((hit) => checked.has(hit.chunkId)).map((hit) => hit.itemKey))]
      if (keys.length === 0) return
      const result = await apiGet<Array<{ itemKey: string; text: string }>>('/api/cite', { item_keys: keys.join(','), format })
      if (!result.ok || result.value === undefined) {
        setToast(result.message ?? t.copyFailed)
        return
      }
      const text = result.value.map((entry) => entry.text).join(format === 'bibtex' ? '\n\n' : '\n')
      const accepted = await writeClipboard(text)
      setToast(accepted ? `${t.copied} · ${keys.length}` : t.copyFailed)
    }, [checked, hits, t.copied, t.copyFailed])

    const quoteSelected = useCallback(async () => {
      const keys = [...new Set(hits.filter((hit) => checked.has(hit.chunkId)).map((hit) => hit.itemKey))]
      if (keys.length === 0) return
      const result = await apiGet<Array<{ itemKey: string; text: string }>>('/api/cite', { item_keys: keys.join(','), format: 'author-year' })
      if (!result.ok || result.value === undefined) {
        setToast(result.message ?? t.copyFailed)
        return
      }
      const text = result.value.map((entry) => entry.text).join(' ')
      const insert = props.inputActions?.insertQuote
      if (insert === undefined) {
        const accepted = await writeClipboard(text)
        setToast(accepted ? t.copied : t.copyFailed)
        return
      }
      try {
        insert(text, 'ZoteroSeek 引用')
        setToast('已放入输入框')
      } catch {
        // 宿主版本差异时退回复制，不让面板崩掉。
        const accepted = await writeClipboard(text)
        setToast(accepted ? t.copied : t.copyFailed)
      }
    }, [checked, hits, props.inputActions, t.copied, t.copyFailed])

    const saveSettings = useCallback(async () => {
      const result = await apiPost<{ mineruConfigured: boolean }>('/api/settings', {
        mineruToken: tokenDraft,
        ...(storageDraft.length === 0 ? {} : { zoteroStorageDir: storageDraft }),
      })
      if (result.ok) {
        setToast(t.saved)
        setSettingsOpen(false)
        await loadStatus()
      } else setError(result.message ?? '保存失败')
    }, [loadStatus, storageDraft, t.saved, tokenDraft])

    useEffect(() => {
      if (toast.length === 0) return
      const id = setTimeout(() => setToast(''), 2200)
      return () => clearTimeout(id)
    }, [toast])

    const imageUrl = useCallback((src: string) => {
      const itemKey = doc?.item.key ?? selected?.key ?? ''
      return `/zotero-seek/file?item_key=${encodeURIComponent(itemKey)}&path=${encodeURIComponent(src)}`
    }, [doc, selected])

    return h('div', { style: S.root },
      h('div', { style: S.header },
        h('img', {
          src: zsIcon,
          alt: '',
          width: 18,
          height: 18,
          style: { display: 'block', borderRadius: 4 },
          draggable: false,
        }),
        h('span', { style: S.brand }, t.appName),
        h('span', { style: S.headerSpacer }),
        h('button', { style: S.iconButton, title: t.settings, onClick: () => setSettingsOpen((open) => !open) }, '⚙'),
        h('button', { style: S.iconButton, title: t.refresh, onClick: () => { void loadItems(filter); void loadStatus() } }, '↻'),
      ),
      h('div', { style: S.segmented },
        segment(t.tabLibrary, view === 'library', () => setView('library')),
        segment(t.tabReader, view === 'reader', () => setView('reader')),
        segment(t.tabHits, view === 'hits', () => setView('hits')),
      ),
      status !== null ? h(StatusBar, { status, t, onOpenSettings: () => setSettingsOpen(true) }) : null,
      settingsOpen ? h(SettingsDrawer, {
        t, tokenDraft, storageDraft, setTokenDraft, setStorageDraft, saveSettings,
        close: () => setSettingsOpen(false),
        mineruHint: status?.mineru.tokenSource === 'env' ? 'env MINERU_TOKEN' : '',
      }) : null,
      error.length > 0 ? h('div', { style: S.error, role: 'alert' },
        h('span', { style: { flex: 1 } }, error),
        h('button', { style: S.linkButton, onClick: () => setError('') }, t.close),
      ) : null,
      h('div', { style: S.body, ref: scrollRef },
        view === 'library' ? h(LibraryView, {
          t, items, filter, setFilter, busy, runIndex, openDoc,
          history, clearHistory,
          onFilter: () => {
            const keyword = filter.trim()
            if (keyword.length > 0) rememberQuery(keyword)
            void loadItems(filter)
          },
          pickHistory: (value: string) => {
            setFilter(value)
            rememberQuery(value)
            void loadItems(value)
          },
        }) : null,
        view === 'reader' ? h(ReaderView, {
          t, doc, selected, imageUrl, busy, onBack: () => setView('library'),
          onSearchHere: () => {
            if (query.trim().length === 0) return
            void runSearch(query, selected?.key)
          },
          query, setQuery, runSearch,
        }) : null,
        view === 'hits' ? h(HitsView, {
          t, hits, checked, toggle, query, setQuery, busy,
          expansionHint,
          admission,
          hasSearched, history, clearHistory,
          runSearch: () => { if (query.trim().length > 0) void runSearch(query) },
          pickHistory: (value: string) => { setQuery(value); void runSearch(value) },
          copyCitations,
          quoteSelected,
          openItem: (itemKey: string) => {
            const item = items.find((candidate) => candidate.key === itemKey)
            if (item !== undefined) void openDoc(item)
          },
        }) : null,
      ),
      toast.length > 0 ? h('div', { style: S.toast }, toast) : null,
    )
  }
}

// ------------------------------------------------------------------ 子视图

function segment(label: string, active: boolean, onClick: () => void, disabled = false): ReactNode {
  return h('button', {
    key: label,
    style: { ...S.segment, ...(active ? S.segmentActive : {}), ...(disabled ? S.segmentDisabled : {}) },
    disabled,
    onClick,
  }, label)
}

function StatusBar(props: { status: StatusView; t: Dict; onOpenSettings: () => void }): ReactNode {
  const { status, t, onOpenSettings } = props
  const zoteroOk = status.zotero.reachable
  const mineruOk = status.mineru.tokenValid === true
  const mineruConfigured = status.mineru.configured
  return h('div', { style: S.statusBar },
    h('span', { style: { ...S.dot, background: zoteroOk ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }, title: status.zotero.message }),
    h('span', { style: S.statusText }, zoteroOk ? `${status.library.items} 条文献` : t.zoteroDown),
    h('span', { style: { ...S.dot, background: mineruOk ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }, title: status.mineru.tokenMessage }),
    h('span', { style: S.statusText }, `${status.library.parsedItems} 已入库`),
    h('span', { style: S.statusText }, `${status.library.chunks} 分块`),
    mineruOk ? null : h('button', { style: S.linkButton, onClick: onOpenSettings }, mineruConfigured ? 'Token 失效，去更新' : '配置 MinerU'),
  )
}

function SettingsDrawer(props: {
  t: Dict
  tokenDraft: string
  storageDraft: string
  setTokenDraft: (value: string) => void
  setStorageDraft: (value: string) => void
  saveSettings: () => void
  close: () => void
  mineruHint: string
}): ReactNode {
  const { t } = props
  return h('div', { style: S.drawer },
    h('label', { style: S.field },
      h('span', { style: S.fieldLabel }, t.mineruToken, props.mineruHint.length > 0 ? h('span', { style: S.hint }, ` （当前来自 ${props.mineruHint}）`) : null),
      h('input', {
        style: S.input,
        type: 'password',
        placeholder: 'eyJ0eXAiOiJKV1Qi…',
        value: props.tokenDraft,
        onChange: (event: { target: { value: string } }) => props.setTokenDraft(event.target.value),
      }),
      h('span', { style: S.hint }, t.mineruTokenHint),
    ),
    h('label', { style: S.field },
      h('span', { style: S.fieldLabel }, t.zoteroStorage),
      h('input', {
        style: S.input,
        placeholder: 'C:\\Users\\me\\Zotero\\storage',
        value: props.storageDraft,
        onChange: (event: { target: { value: string } }) => props.setStorageDraft(event.target.value),
      }),
    ),
    h('div', { style: { display: 'flex', gap: 8 } },
      h('button', { style: S.primaryButton, onClick: props.saveSettings }, t.save),
      h('button', { style: S.button, onClick: props.close }, t.close),
    ),
  )
}

function LibraryView(props: {
  t: Dict
  items: ItemView[]
  filter: string
  setFilter: (value: string) => void
  onFilter: () => void
  busy: string
  runIndex: (item: ItemView) => void
  openDoc: (item: ItemView) => void
  history: string[]
  pickHistory: (value: string) => void
  clearHistory: () => void
}): ReactNode {
  const { t, items, filter, setFilter, onFilter, busy, runIndex, openDoc } = props
  return h(Fragment, null,
    h('div', { style: S.searchRow },
      h('input', {
        style: S.input,
        placeholder: t.searchPlaceholder,
        value: filter,
        onChange: (event: { target: { value: string } }) => setFilter(event.target.value),
        onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') onFilter() },
      }),
      h('button', { style: S.button, onClick: onFilter }, t.search),
    ),
    h('div', { style: S.libraryHint }, t.libraryHint),
    props.history.length > 0 ? h('div', { style: S.historyRow },
      h('span', { style: S.historyLabel }, t.history),
      ...props.history.map((entry) => h('button', {
        key: `lh-${entry}`,
        style: S.historyChip,
        title: entry,
        onClick: () => props.pickHistory(entry),
      }, entry.length > 24 ? `${entry.slice(0, 24)}…` : entry)),
      h('button', { style: S.historyClear, onClick: props.clearHistory }, t.clearHistory),
    ) : null,
    items.length === 0
      ? h('div', { style: S.empty }, t.noItems)
      : h('div', { style: S.list },
        items.map((item) => h('div', { key: item.key, style: S.itemRow },
          h('div',
            { style: S.itemMain, onClick: () => (item.parsed ? openDoc(item) : runIndex(item)) },
            h('div', { style: S.itemTitle }, item.title),
            h('div', { style: S.itemMeta },
              [item.creators[0] ?? '', item.year === null ? '' : String(item.year), item.publicationTitle ?? '']
                .filter((part) => part.length > 0).join(' · '),
            ),
          ),
          item.parsed
            ? h('span', { style: S.badgeOk }, t.indexOk)
            : h('button', {
              style: busy === item.key ? S.buttonDisabled : S.button,
              disabled: busy === item.key,
              onClick: () => runIndex(item),
            }, busy === item.key ? t.indexing : t.index),
        )),
      ),
  )
}

function ReaderView(props: {
  t: Dict
  doc: MarkdownView | null
  selected: ItemView | null
  imageUrl: (src: string) => string
  busy: string
  onBack: () => void
  onSearchHere: () => void
  query: string
  setQuery: (value: string) => void
  runSearch: (keyword: string, itemKey?: string) => void
}): ReactNode {
  const { t, doc, selected } = props
  const renderMarkdownToHtml = useMemo(
    () => createMarkdownRenderer({ imageUrl: props.imageUrl }),
    [props.imageUrl],
  )
  const renderedHtml = useMemo(
    () => (doc === null ? '' : renderMarkdownToHtml(doc.markdown)),
    [doc, renderMarkdownToHtml],
  )
  if (selected === null) return h('div', { style: S.empty }, t.readerEmpty)
  const title = doc?.item.title ?? selected.title
  return h(Fragment, null,
    h('div', { style: S.readerHeader },
      h('button', { style: S.linkButton, onClick: props.onBack }, `← ${t.back}`),
      h('span', { style: S.readerTitle, title }, title),
    ),
    h('div', { style: S.readerMeta },
      [selected.year === null ? '' : String(selected.year), doc?.parsed === null || doc?.parsed === undefined ? t.notParsed : `${doc.chunks.length} ${t.chunks}`]
        .filter((part) => part.length > 0).join(' · '),
      doc?.parsed != null ? ` · ${t.parsedAt} ${new Date(doc.parsed.parsedAt).toLocaleString()}` : '',
    ),
    h('div', { style: S.searchRow },
      h('input', {
        style: S.input,
        placeholder: t.queryPlaceholder,
        value: props.query,
        onChange: (event: { target: { value: string } }) => props.setQuery(event.target.value),
        onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') props.runSearch(props.query, selected.key) },
      }),
      h('button', { style: S.button, onClick: props.onSearchHere }, t.inThisDoc),
    ),
    doc === null
      ? h('div', { style: S.empty }, t.loading)
      : doc.parsed === null
        ? h('div', { style: S.empty }, t.notParsed)
        : h('div', { style: S.markdown },
          h('style', { dangerouslySetInnerHTML: { __html: `${KATEX_CSS}\n${MARKDOWN_CSS}` } }),
          h('div', { className: 'zse-md', dangerouslySetInnerHTML: { __html: renderedHtml } }),
        ),
  )
}

function HitsView(props: {
  t: Dict
  hits: HitView[]
  checked: Set<string>
  toggle: (chunkId: string) => void
  query: string
  setQuery: (value: string) => void
  busy: string
  runSearch: () => void
  expansionHint: string
  hasSearched: boolean
  admission: { minCoverage: number; margin: number; candidates: number; admitted: number } | null
  history: string[]
  clearHistory: () => void
  pickHistory: (value: string) => void
  copyCitations: (format: 'author-year' | 'reference' | 'bibtex') => void
  quoteSelected: () => void
  openItem: (itemKey: string) => void
}): ReactNode {
  const { t, hits, checked, toggle } = props
  return h(Fragment, null,
    h('div', { style: S.searchRow },
      h('input', {
        style: S.input,
        placeholder: t.queryPlaceholder,
        value: props.query,
        onChange: (event: { target: { value: string } }) => props.setQuery(event.target.value),
        onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') props.runSearch() },
      }),
      h('button', { style: S.button, onClick: props.runSearch }, props.busy === 'search' ? t.loading : t.runSearch),
    ),
    props.expansionHint.length > 0
      ? h('div', { style: S.expansionHint }, props.expansionHint)
      : null,
    h('div', { style: S.searchLegend }, t.searchLegend),
    props.admission !== null && props.admission.candidates > 0
      ? h('div', { style: S.admissionLine },
        `扩展路准入：覆盖率≥${props.admission.minCoverage}、余量 ${Math.round((1 - props.admission.margin) * 100)}%，放行 ${props.admission.admitted}/${props.admission.candidates}`)
      : null,
    props.history.length > 0 ? h('div', { style: S.historyRow },
      h('span', { style: S.historyLabel }, t.history),
      ...props.history.map((entry) => h('button', {
        key: `h-${entry}`,
        style: S.historyChip,
        title: entry,
        onClick: () => props.pickHistory(entry),
      }, entry.length > 24 ? `${entry.slice(0, 24)}…` : entry)),
      h('button', { style: S.historyClear, onClick: props.clearHistory }, t.clearHistory),
    ) : null,
    hits.length > 0
      ? h(Fragment, null,
        h('div', { style: S.list },
          hits.map((hit) => h(HitCard, {
            key: hit.chunkId,
            t,
            hit,
            checked: checked.has(hit.chunkId),
            toggle: () => toggle(hit.chunkId),
            openItem: () => props.openItem(hit.itemKey),
          })),
        ),
        checked.size > 0 ? h('div', { style: S.actionBar },
          h('span', { style: S.actionLabel }, `${t.selected} ${checked.size}`),
          h('button', { style: S.primarySmallButton, onClick: props.quoteSelected }, '引用到对话'),
          h('button', { style: S.smallButton, onClick: () => props.copyCitations('author-year') }, t.copyCitation),
          h('button', { style: S.smallButton, onClick: () => props.copyCitations('reference') }, t.copyReference),
          h('button', { style: S.smallButton, onClick: () => props.copyCitations('bibtex') }, t.copyBibtex),
        ) : null,
      )
      : h('div', { style: S.empty }, props.hasSearched ? t.noHits : t.searchEmpty),
  )
}

function HitCard(props: {
  t: Dict
  hit: HitView
  checked: boolean
  toggle: () => void
  openItem: () => void
}): ReactNode {
  const { t, hit, checked } = props
  const [expanded, setExpanded] = useState(false)
  const kind = hit.matchKind ?? (hit.route === 'expanded' ? 'expanded' : hit.route === 'both' ? 'mixed' : 'literal')
  const kindLabel = kind === 'expanded' ? t.kindExpanded : kind === 'mixed' ? t.kindMixed : t.kindLiteral
  const badgeStyle = kind === 'expanded'
    ? { ...S.hitBadge, ...S.hitBadgeExpanded }
    : kind === 'mixed'
      ? { ...S.hitBadge, ...S.hitBadgeMixed }
      : S.hitBadge
  return h('div', { style: { ...S.hitCard, ...(checked ? S.hitCardChecked : {}) } },
    h('div', { style: S.hitHead },
      h('input', { type: 'checkbox', checked, onChange: props.toggle, style: S.checkbox }),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: S.hitTitle, onClick: props.openItem }, hit.title),
        h('div', { style: S.hitMeta },
          h('span', { style: badgeStyle, title: kind === 'expanded' ? t.kindExpandedHint : undefined }, kindLabel),
          h('span', { style: { marginLeft: 6 } },
            [hit.source === 'meta'
              ? (hit.indexed ? '元数据' : '元数据·未入库')
              : hit.sectionPath,
              hit.page === null ? '' : `第 ${hit.page + 1} 页`,
              hit.source === 'meta' ? '' : hit.kind,
              `score ${hit.score}`]
              .filter((part) => part.length > 0).join(' · ')),
          h('span', { style: S.chunkId }, ` ${hit.chunkId}`),
        ),
      ),
    ),
    h('div', {
      style: S.scoreTrack,
      title: `词面 ${hit.lexicalScore ?? 0} · 扩展 ${hit.expandedScore ?? 0} · 融合 ${hit.scoreNorm ?? 0}`,
    }, h('div', {
      style: {
        ...S.scoreFill,
        width: `${Math.round((hit.scoreNorm ?? 0) * 100)}%`,
        background: kind === 'expanded' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
      },
    })),
    h('div', {
      style: expanded ? S.hitTextExpanded : S.hitText,
      onClick: () => setExpanded((value) => !value),
    }, hit.text),
  )
}

// ------------------------------------------------------------------ 公式渲染

/**
 * 把 LaTeX 片段转成「人能读」的纯文本。
 *
 * 为什么不上 KaTeX：真正的数学排版要打包 ~300 KB 的引擎与字体，而文献阅读里
 * 99% 的公式只需要「看懂」，不需要「印刷级」。这里做一层确定性的符号替换：
 * 希腊字母、常用运算符 → Unicode，\frac/\sqrt → 括号形式，上下标 → ^( ) / _( )，
 * 然后按原样保留换行。原始 LaTeX 留在 title 里，鼠标悬停仍可看到。
 */
const LATEX_SYMBOLS: Record<string, string> = {
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε', '\\varepsilon': 'ε',
  '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\vartheta': 'ϑ', '\\iota': 'ι', '\\kappa': 'κ',
  '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ', '\\sigma': 'σ',
  '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ', '\\varphi': 'φ', '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
  '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ', '\\Xi': 'Ξ', '\\Pi': 'Π',
  '\\Sigma': 'Σ', '\\Phi': 'Φ', '\\Psi': 'Ψ', '\\Omega': 'Ω',
  '\\partial': '∂', '\\nabla': '∇', '\\sum': 'Σ', '\\prod': '∏', '\\int': '∫', '\\iint': '∬',
  '\\oint': '∮', '\\infty': '∞', '\\times': '×', '\\cdot': '·', '\\pm': '±', '\\mp': '∓',
  '\\le': '≤', '\\leq': '≤', '\\ge': '≥', '\\geq': '≥', '\\ne': '≠', '\\neq': '≠',
  '\\approx': '≈', '\\equiv': '≡', '\\propto': '∝', '\\sim': '~',
  '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\leftrightarrow': '↔',
  '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\cup': '∪', '\\cap': '∩',
  '\\forall': '∀', '\\exists': '∃', '\\emptyset': '∅', '\\angle': '∠', '\\perp': '⊥', '\\parallel': '∥',
  '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan', '\\cot': 'cot', '\\log': 'log', '\\ln': 'ln',
  '\\exp': 'exp', '\\max': 'max', '\\min': 'min', '\\lim': 'lim', '\\det': 'det',
  '\\quad': '  ', '\\qquad': '    ', '\\,': ' ', '\\;': ' ', '\\!': '', '\\ ': ' ',
}

/** 读一个平衡的 {…} 组，返回内容与结束位置。 */
function readBraceGroup(source: string, start: number): { body: string; next: number } | null {
  if (source[start] !== '{') return null
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { body: source.slice(start + 1, index), next: index + 1 }
    }
  }
  return null
}

export function latexToText(source: string): string {
  let text = source.replace(/\r\n/g, '\n')
  // \frac{a}{b} → (a)/(b)，嵌套时递归处理
  for (let guard = 0; guard < 20; guard += 1) {
    const at = text.indexOf('\\frac')
    if (at < 0) break
    const first = readBraceGroup(text, at + 5)
    if (first === null) { text = text.replace('\\frac', ''); continue }
    const second = readBraceGroup(text, first.next)
    if (second === null) { text = text.replace('\\frac', ''); continue }
    text = `${text.slice(0, at)}(${latexToText(first.body)})/(${latexToText(second.body)})${text.slice(second.next)}`
  }
  // \sqrt[n]{x} / \sqrt{x}
  text = text.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '√[$1]($2)')
  text = text.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
  // \text{…} \mathrm{…} 等：只保留内容
  text = text.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|mbox)\s*\{([^{}]*)\}/g, '$1')
  // 上下标：^{…} → ^(…)，_{…} → _(…)
  text = text.replace(/\^\s*\{([^{}]*)\}/g, '^($1)')
  text = text.replace(/_\s*\{([^{}]*)\}/g, '_($1)')
  text = text.replace(/\^\s*([A-Za-z0-9+\-])/g, '^$1')
  text = text.replace(/_\s*([A-Za-z0-9+\-])/g, '_$1')
  // 公式编号 \tag{4} → (4)
  text = text.replace(/\\tag\s*\{([^{}]*)\}/g, '  ($1)')
  // 环境与排版指令
  text = text.replace(/\\begin\{[^}]*\}/g, '').replace(/\\end\{[^}]*\}/g, '')
  text = text.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b/g, '')
  text = text.replace(/\\\\/g, '\n')
  text = text.replace(/&/g, ' ')
  // 符号表
  for (const [command, symbol] of Object.entries(LATEX_SYMBOLS)) {
    text = text.split(command).join(symbol)
  }
  // 残留花括号与多余空白
  text = text.replace(/[{}]/g, '')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

/** 公式块：读起来像公式，原始 LaTeX 放在 title 提示里。 */
function mathBlock(raw: string, key: string): ReactNode {
  return h('div', { key, style: S.formulaBlock, title: raw },
    h('div', { style: S.formulaText }, latexToText(raw)),
    h('div', { style: S.formulaNote }, '公式（悬停查看 LaTeX）'),
  )
}

// ------------------------------------------------------------------ Markdown 渲染

interface MarkdownOptions {
  imageUrl: (src: string) => string
  translate: Dict
}

/** 轻量 Markdown 渲染：标题/段落/列表/表格/公式/代码/图片，够读 MinerU 的 full.md。 */
function renderMarkdown(markdown: string, options: MarkdownOptions): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  let index = 0
  let key = 0

  const nextKey = (): string => `md-${key++}`

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (trimmed.length === 0) { index += 1; continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      const level = heading[1]?.length ?? 1
      nodes.push(h(`h${Math.min(6, level + 1)}`, { key: nextKey(), style: headingStyle(level) }, inline(heading[2] ?? '', options)))
      index += 1
      continue
    }

    if (trimmed === '---' || trimmed === '***') {
      nodes.push(h('hr', { key: nextKey(), style: S.hr }))
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      nodes.push(h('pre', { key: nextKey(), style: S.pre }, h('code', null, code.join('\n'))))
      continue
    }

    if (trimmed.startsWith('<table')) {
      const table: string[] = []
      while (index < lines.length) {
        table.push(lines[index] ?? '')
        if ((lines[index] ?? '').includes('</table>')) { index += 1; break }
        index += 1
      }
      nodes.push(h('div', {
        key: nextKey(),
        style: S.tableWrap,
        dangerouslySetInnerHTML: { __html: sanitizeHtml(table.join('\n')) },
      }))
      continue
    }

    if (trimmed.startsWith('|')) {
      const rows: string[][] = []
      while (index < lines.length) {
        const row = (lines[index] ?? '').trim()
        if (!row.startsWith('|')) break
        if (!/^\|[\s:|-]+\|$/.test(row)) {
          rows.push(row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
        }
        index += 1
      }
      if (rows.length > 0) nodes.push(markdownTable(rows, nextKey, options))
      continue
    }

    if (trimmed.startsWith('![')) {
      const image = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(trimmed)
      if (image !== null) {
        const source = image[2] ?? ''
        nodes.push(h('figure', { key: nextKey(), style: S.figure },
          h('img', {
            src: source.startsWith('http') ? source : options.imageUrl(source),
            alt: image[1] ?? '',
            style: S.image,
            loading: 'lazy',
          }),
          (image[1] ?? '').trim().length > 0 ? h('figcaption', { style: S.caption }, image[1]) : null,
        ))
        index += 1
        continue
      }
    }

    if (trimmed.startsWith('$$')) {
      const formula: string[] = []
      const single = trimmed.length > 4 && trimmed.endsWith('$$')
      formula.push(single ? trimmed.slice(2, -2) : trimmed)
      index += 1
      if (!single) {
        while (index < lines.length) {
          const current = lines[index] ?? ''
          if (current.trim().endsWith('$$')) {
            formula.push(current.trim().slice(0, -2))
            index += 1
            break
          }
          formula.push(current)
          index += 1
        }
      }
      nodes.push(mathBlock(formula.join('\n').trim(), nextKey()))
      continue
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const listItems: string[] = []
      while (index < lines.length && /^[-*+]\s+/.test((lines[index] ?? '').trim())) {
        listItems.push((lines[index] ?? '').trim().replace(/^[-*+]\s+/, ''))
        index += 1
      }
      nodes.push(h('ul', { key: nextKey(), style: S.ul }, listItems.map((text) => h('li', { key: nextKey() }, inline(text, options)))))
      continue
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const listItems: string[] = []
      while (index < lines.length && /^\d+[.)]\s+/.test((lines[index] ?? '').trim())) {
        listItems.push((lines[index] ?? '').trim().replace(/^\d+[.)]\s+/, ''))
        index += 1
      }
      nodes.push(h('ol', { key: nextKey(), style: S.ul }, listItems.map((text) => h('li', { key: nextKey() }, inline(text, options)))))
      continue
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quote.push((lines[index] ?? '').trim().replace(/^>\s?/, ''))
        index += 1
      }
      nodes.push(h('blockquote', { key: nextKey(), style: S.quote }, inline(quote.join(' '), options)))
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = (lines[index] ?? '').trim()
      if (current.length === 0 || current.startsWith('#') || current.startsWith('![')
        || current.startsWith('|') || current.startsWith('```') || current.startsWith('$$')
        || current.startsWith('<table') || current.startsWith('>') || /^[-*+]\s+/.test(current)
        || /^\d+[.)]\s+/.test(current)) break
      paragraph.push(current)
      index += 1
    }
    if (paragraph.length > 0) {
      nodes.push(h('p', { key: nextKey(), style: S.paragraph }, inline(paragraph.join(' '), options)))
    } else {
      index += 1
    }
  }
  return nodes
}

/** 行内样式：**粗体**、`代码`、$行内公式$。 */
function inline(text: string, options: MarkdownOptions): ReactNode[] {
  const nodes: ReactNode[] = []
  // 行内 HTML（中文文献常见 <sup>[1]</sup>）与公式、粗体、行内代码一起切分
  const pattern = /(<sup>[\s\S]*?<\/sup>|<sub>[\s\S]*?<\/sub>|\*\*[^*]+\*\*|`[^`]+`|\$[^$]+\$)/g
  let cursor = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) nodes.push(cleanInlineHtml(text.slice(cursor, start)))
    const token = match[0]
    if (token.startsWith('<sup>')) nodes.push(h('sup', { key: `s-${index++}` }, cleanInlineHtml(token.slice(5, -6))))
    else if (token.startsWith('<sub>')) nodes.push(h('sub', { key: `u-${index++}` }, cleanInlineHtml(token.slice(5, -6))))
    else if (token.startsWith('**')) nodes.push(h('strong', { key: `b-${index++}` }, token.slice(2, -2)))
    else if (token.startsWith('`')) nodes.push(h('code', { key: `c-${index++}`, style: S.inlineCode }, token.slice(1, -1)))
    else nodes.push(h('span', { key: `m-${index++}`, style: S.mathInline, title: token }, latexToText(token.slice(1, -1))))
    cursor = start + token.length
  }
  if (cursor < text.length) nodes.push(cleanInlineHtml(text.slice(cursor)))
  void options
  return nodes
}

/** 去掉行内 HTML 标签，只保留文字（表格另行处理）。 */
function cleanInlineHtml(text: string): string {
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[A-Za-z][^>]*>/g, '')
}

function markdownTable(rows: string[][], nextKey: () => string, options: MarkdownOptions): ReactNode {
  const [head, ...body] = rows
  return h('div', { key: nextKey(), style: S.tableWrap },
    h('table', { style: S.table },
      head === undefined ? null : h('thead', null,
        h('tr', null, head.map((cell) => h('th', { key: nextKey(), style: S.th }, inline(cell, options)))),
      ),
      h('tbody', null, body.map((row) => h('tr', { key: nextKey() },
        row.map((cell) => h('td', { key: nextKey(), style: S.td }, inline(cell, options))),
      ))),
    ),
  )
}

/** MinerU 的表格是 HTML；这里只允许基础标签，去掉脚本与事件属性。 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
}

// ------------------------------------------------------------------ 历史检索

const SEARCH_HISTORY_KEY = 'zotero-seek/search-history/v1'

/** 读取本机的检索历史；localStorage 不可用时安静降级为空列表。 */
function loadSearchHistory(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(SEARCH_HISTORY_KEY)
    if (raw === null || raw === undefined) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, 10) : []
  } catch {
    return []
  }
}

function saveSearchHistory(entries: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // 隐私模式/配额满：历史只是便利功能，不阻塞检索
  }
}

// ------------------------------------------------------------------ 数据面

async function apiGet<T>(path: string, params: Record<string, string> = {}): Promise<ApiResult<T>> {
  const search = new URLSearchParams(params).toString()
  return request<T>(`/zotero-seek${path}${search.length === 0 ? '' : `?${search}`}`)
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<ApiResult<T>> {
  return request<T>(`/zotero-seek${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, init)
    const payload = (await response.json()) as ApiResult<T>
    return payload
  } catch (error) {
    return { ok: false, code: 'network', message: `面板请求失败：${(error as Error).message}` }
  }
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard === undefined) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ 样式

const S: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 13,
    lineHeight: 1.55,
    position: 'relative',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 12px 6px',
  },
  brand: { fontWeight: 600, fontSize: 13, letterSpacing: 0.2 },
  headerSpacer: { flex: 1 },
  iconButton: {
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    borderRadius: 6,
    width: 26,
    height: 26,
    cursor: 'pointer',
    lineHeight: 1,
    fontSize: 13,
  },
  segmented: { display: 'flex', gap: 4, padding: '0 12px 8px' },
  segment: {
    flex: 1,
    padding: '6px 8px',
    borderRadius: 7,
    // 不用 border：宿主的默认 button 样式/焦点环可能在深色主题下画出白边（用户反馈过）
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    fontSize: 12,
    outline: 'none',
    boxShadow: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'background-color .15s ease, color .15s ease',
  },
  segmentActive: {
    // 选中态用「品牌色淡底 + 内描边」，不依赖 border，暗色主题下也不会出现白框
    background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent)',
    color: 'var(--dsw-alias-label-primary)',
    fontWeight: 650,
  },
  segmentDisabled: { opacity: 0.45, cursor: 'default' },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderTop: '1px solid var(--dsw-alias-border-l1)',
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 11,
    flexWrap: 'wrap',
  },
  dot: { width: 6, height: 6, borderRadius: 3, display: 'inline-block' },
  statusText: { marginRight: 4 },
  drawer: {
    padding: '10px 12px',
    background: 'var(--dsw-alias-bg-layer-1)',
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
  hint: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', opacity: 0.8 },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '8px 12px 0',
    padding: '6px 8px',
    borderRadius: 6,
    background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)',
    color: 'var(--dsw-alias-state-error-primary)',
    fontSize: 12,
  },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px 24px' },
  searchRow: { display: 'flex', gap: 6, marginBottom: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 12,
    outline: 'none',
  },
  button: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  buttonDisabled: { opacity: 0.5, cursor: 'default' },
  primaryButton: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-brand-primary)',
    background: 'var(--dsw-alias-brand-primary)',
    color: 'var(--dsw-alias-bg-base)',
    cursor: 'pointer',
    fontSize: 12,
  },
  smallButton: {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    fontSize: 11,
    whiteSpace: 'nowrap',
  },
  primarySmallButton: {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-brand-primary)',
    background: 'var(--dsw-alias-brand-primary)',
    color: 'var(--dsw-alias-bg-base)',
    cursor: 'pointer',
    fontSize: 11,
    whiteSpace: 'nowrap',
  },
  linkButton: {
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-brand-primary)',
    cursor: 'pointer',
    fontSize: 11,
    padding: 0,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 8px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-1)',
  },
  itemMain: { flex: 1, minWidth: 0, cursor: 'pointer' },
  itemTitle: { fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  itemMeta: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 },
  badgeOk: {
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 10,
    color: 'var(--dsw-alias-state-success-primary)',
    border: '1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent)',
    whiteSpace: 'nowrap',
  },
  empty: { padding: '24px 8px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, textAlign: 'center' },
  readerHeader: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  readerTitle: { fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  readerMeta: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 },
  markdown: { fontSize: 12.5, lineHeight: 1.7 },
  paragraph: { margin: '0 0 8px' },
  heading1: { fontSize: 15, margin: '14px 0 6px', fontWeight: 700 },
  heading2: { fontSize: 14, margin: '12px 0 6px', fontWeight: 700 },
  heading3: { fontSize: 13, margin: '10px 0 4px', fontWeight: 600 },
  heading4: { fontSize: 12.5, margin: '8px 0 4px', fontWeight: 600 },
  heading5: { fontSize: 12, margin: '8px 0 4px', fontWeight: 600 },
  heading6: { fontSize: 12, margin: '8px 0 4px', fontWeight: 600 },
  ul: { margin: '0 0 8px', paddingLeft: 18 },
  quote: {
    margin: '0 0 8px',
    paddingLeft: 10,
    borderLeft: '2px solid var(--dsw-alias-border-l2)',
    color: 'var(--dsw-alias-label-secondary)',
  },
  hr: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1)', margin: '12px 0' },
  pre: {
    margin: '0 0 8px',
    padding: 8,
    borderRadius: 6,
    background: 'var(--dsw-alias-bg-layer-2)',
    overflowX: 'auto',
    fontSize: 11.5,
  },
  formula: {
    margin: '0 0 8px',
    padding: 8,
    borderRadius: 6,
    background: 'var(--dsw-alias-bg-layer-2)',
    overflowX: 'auto',
    fontSize: 11.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    textAlign: 'center',
  },
  mathInline: { fontFamily: '"Cambria Math", "Latin Modern Math", serif', fontSize: 12.5, fontStyle: 'italic' },
  formulaBlock: {
    margin: '0 0 10px',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-1)',
    overflowX: 'auto',
  },
  formulaText: {
    fontFamily: '"Cambria Math", "Latin Modern Math", "STIX Two Math", serif',
    fontSize: 12.5,
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
  },
  formulaNote: { marginTop: 4, fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)', opacity: 0.7 },
  inlineCode: { background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 4, padding: '0 3px', fontSize: 11.5 },
  tableWrap: { overflowX: 'auto', margin: '0 0 10px' },
  table: { borderCollapse: 'collapse', fontSize: 11.5, width: '100%' },
  th: { border: '1px solid var(--dsw-alias-border-l1)', padding: '4px 6px', background: 'var(--dsw-alias-bg-layer-2)', textAlign: 'left' },
  td: { border: '1px solid var(--dsw-alias-border-l1)', padding: '4px 6px' },
  figure: { margin: '0 0 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  image: { maxWidth: '100%', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)' },
  caption: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' },
  hitCard: {
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-1)',
    borderRadius: 8,
    padding: '7px 8px',
  },
  hitCardChecked: { borderColor: 'var(--dsw-alias-brand-primary)' },
  hitHead: { display: 'flex', gap: 8, alignItems: 'flex-start' },
  checkbox: { marginTop: 2, accentColor: 'var(--dsw-alias-brand-primary)' },
  modeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    fontSize: 10.5,
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    flexWrap: 'wrap',
  },
  expansionHint: { fontSize: 10.5, color: 'var(--dsw-alias-brand-primary)', opacity: 0.9, marginBottom: 8 },
  libraryHint: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', opacity: 0.85, marginBottom: 8 },
  historyRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  historyLabel: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' },
  historyChip: {
    fontSize: 10.5,
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  historyClear: {
    fontSize: 10.5,
    padding: '2px 6px',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-brand-primary)',
    cursor: 'pointer',
  },
  hitTitle: { fontSize: 12, fontWeight: 500, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  hitMeta: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', display: 'flex', alignItems: 'center', flexWrap: 'wrap' },
  hitBadge: {
    fontSize: 9.5,
    padding: '0 5px',
    borderRadius: 999,
    border: '1px solid var(--dsw-alias-border-l1)',
    color: 'var(--dsw-alias-label-secondary)',
    lineHeight: '15px',
    flexShrink: 0,
  },
  hitBadgeExpanded: {
    borderColor: 'var(--dsw-alias-brand-primary)',
    color: 'var(--dsw-alias-brand-primary)',
  },
  hitBadgeMixed: {
    borderColor: 'var(--dsw-alias-brand-primary)',
    background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)',
    color: 'var(--dsw-alias-brand-primary)',
  },
  scoreTrack: {
    height: 2,
    margin: '4px 0 2px',
    borderRadius: 2,
    background: 'var(--dsw-alias-bg-layer-2)',
    overflow: 'hidden',
  },
  scoreFill: { height: '100%', borderRadius: 2, opacity: 0.75 },
  searchLegend: {
    fontSize: 10,
    color: 'var(--dsw-alias-label-secondary)',
    opacity: 0.85,
    marginBottom: 6,
    lineHeight: 1.5,
  },
  admissionLine: { fontSize: 10, color: 'var(--dsw-alias-brand-primary)', opacity: 0.9, marginBottom: 8 },
  chunkId: { opacity: 0.7, fontFamily: 'ui-monospace, monospace' },
  hitText: {
    marginTop: 4,
    fontSize: 11.5,
    color: 'var(--dsw-alias-label-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    cursor: 'pointer',
  },
  hitTextExpanded: { marginTop: 4, fontSize: 11.5, whiteSpace: 'pre-wrap', cursor: 'pointer' },
  actionBar: {
    position: 'sticky',
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 0 4px',
    background: 'var(--dsw-alias-bg-base)',
    borderTop: '1px solid var(--dsw-alias-border-l1)',
    flexWrap: 'wrap',
  },
  actionLabel: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginRight: 'auto' },
  toast: {
    position: 'absolute',
    left: '50%',
    bottom: 14,
    transform: 'translateX(-50%)',
    padding: '5px 10px',
    borderRadius: 999,
    background: 'var(--dsw-alias-bg-overlay)',
    border: '1px solid var(--dsw-alias-border-l1)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 11,
    boxShadow: '0 4px 16px rgba(0,0,0,.18)',
    maxWidth: '90%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}

function headingStyle(level: number): CSSProperties {
  return S[`heading${Math.min(6, level)}`] ?? S['heading3'] ?? {}
}

// ------------------------------------------------------------------ 入口

/** 「打开文献库」按钮：放在输入框左侧的工具行里；只放图标，文字靠 tooltip / aria-label。 */
function createOpenButton(t: Dict, open: () => void) {
  return function ZoteroSeekOpenButton(): ReactNode {
    return h('button', {
      type: 'button',
      title: t.appName + ' 文献库',
      'aria-label': t.appName + ' 文献库',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 26,
        padding: 0,
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        cursor: 'pointer',
      },
      onClick: open,
    }, h('img', {
      src: zsIcon,
      alt: '',
      width: 16,
      height: 16,
      style: { display: 'block', borderRadius: 4 },
      draggable: false,
    }))
  }
}

export default {
  inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'locale'],
  apply(ctx: ClientContextLike): void {
    // 词典注册进 locale 服务，界面文案走 DICT；英文词典已备好，等待接入界面语言切换。
    ctx.effect(
      () => ctx.locale.register('zotero-seek', { zh: DICT.zh, en: DICT.en as unknown as Dict }),
      'zotero-seek: dictionaries',
    )
    const translate = DICT.zh as Dict

    // 1) 注册 tab 类型（右栏「文献库」页）
    ctx.effect(() => ctx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      keepMounted: true,
      title: () => translate.appName,
      guide: [{
        id: 'open-library',
        order: 40,
        title: () => translate.appName,
        description: () => translate.searchPlaceholder,
      }],
    }), 'zotero-seek: tab type')

    // 2) 注册 tab 正文
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
    }, createPanel(translate))), 'zotero-seek: panel body')

    // 3) 输入框左侧的入口按钮
    ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'zotero-seek/open',
      order: 60,
    }, createOpenButton(translate, () => ctx.sidebarRight.openTab(TAB_KIND)))), 'zotero-seek: composer button')
  },
}
