import { useEffect, useState, useCallback } from 'react'
import { apiClient, type ZoteroItem, type IndexResult } from '@/api/client'
import { BookOpen, Download, Check, AlertCircle, Loader2, RefreshCw } from 'lucide-react'

interface IndexedItem {
  id: string
  title: string
  authors: string  // JSON string
  year: number
  index_status: string
}

type Tab = 'indexed' | 'zotero'

function parseAuthors(authorsStr: string): string[] {
  try {
    const parsed = JSON.parse(authorsStr)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  return authorsStr ? [authorsStr] : []
}

export default function Library() {
  const [tab, setTab] = useState<Tab>('indexed')
  const [indexedItems, setIndexedItems] = useState<IndexedItem[]>([])
  const [zoteroItems, setZoteroItems] = useState<ZoteroItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [indexResults, setIndexResults] = useState<IndexResult[] | null>(null)
  const [indexProgress, setIndexProgress] = useState<{ current: number; total: number } | null>(null)

  const loadIndexed = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await apiClient.library()
      setIndexedItems(res.data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadZotero = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await apiClient.zoteroItems()
      setZoteroItems(res.data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法连接 Zotero，请确保 Zotero 已启动')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'indexed') loadIndexed()
    else loadZotero()
  }, [tab, loadIndexed, loadZotero])

  const handleBatchIndex = async () => {
    setIndexing(true)
    setIndexResults(null)
    // 计算未索引的 PDF 数量
    const unindexed = zoteroItems.filter(i => !i.indexed && i.attachments.length > 0)
    setIndexProgress({ current: 0, total: unindexed.length })

    try {
      const res = await apiClient.indexZotero(undefined, 'mineru')
      if (res.data.total === 0) {
        setError('No new PDFs to index. All PDFs may already be indexed, or Zotero is not running.')
      } else {
        setIndexResults(res.data.results)
        setIndexProgress({ current: res.data.success, total: res.data.total })
      }
      await loadZotero()
      await loadIndexed()
    } catch (err) {
      setError(
        err instanceof Error
          ? `Index failed: ${err.message}. Make sure Zotero is running.`
          : 'Batch index failed. Make sure Zotero is running.'
      )
    } finally {
      setIndexing(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* 标签栏 + 操作按钮 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <button
            onClick={() => setTab('indexed')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'indexed' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            <BookOpen className="w-4 h-4 inline mr-1.5" />
            Indexed ({indexedItems.length})
          </button>
          <button
            onClick={() => setTab('zotero')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'zotero' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            <Download className="w-4 h-4 inline mr-1.5" />
            Zotero Library
          </button>
        </div>

        {tab === 'zotero' && (
          <div className="flex items-center gap-3">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </div>
            )}
            <button
              onClick={handleBatchIndex}
              disabled={indexing || loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {indexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {indexing ? 'Indexing...' : 'Index All PDFs'}
            </button>
          </div>
        )}

        {tab === 'indexed' && (
          <button onClick={loadIndexed} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 索引进度 */}
      {indexing && indexProgress && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center justify-between text-sm text-blue-700 dark:text-blue-300 mb-2">
            <span>Processing PDFs from Zotero...</span>
            <span>{indexProgress.total} items to index</span>
          </div>
          <div className="w-full h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-progress" style={{ width: '100%' }} />
          </div>
        </div>
      )}

      {/* 索引完成 */}
      {indexResults && !indexing && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
          <Check className="w-4 h-4 inline mr-1" />
          Done: {indexResults.filter(r => r.success).length}/{indexResults.length} indexed
          {indexResults.filter(r => !r.success).length > 0 && (
            <span className="text-red-600 dark:text-red-400 ml-2">
              ({indexResults.filter(r => !r.success).length} failed)
            </span>
          )}
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-800 dark:text-red-300 font-medium">{error}</p>
            <button
              onClick={() => { setError(null); tab === 'indexed' ? loadIndexed() : loadZotero() }}
              className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 mt-1 underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* 骨架屏 */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="p-5 animate-pulse">
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Indexed 列表 */}
      {!loading && tab === 'indexed' && (
        indexedItems.length === 0 ? (
          <EmptyState title="No indexed papers yet" description="Go to the Zotero Library tab to index PDFs." />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {indexedItems.map(item => {
              const authors = parseAuthors(item.authors)
              return (
                <div key={item.id} className="py-5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
                      {item.title}
                    </h3>
                    {item.year && (
                      <span className="shrink-0 text-xs font-mono px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                        {item.year}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {authors.length > 0 ? authors.join(', ') : 'Unknown'}
                  </p>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Zotero 列表 */}
      {!loading && tab === 'zotero' && (
        zoteroItems.length === 0 ? (
          <EmptyState title="No items found" description="Make sure Zotero is running and has items in your library." />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {zoteroItems.map(item => (
              <div key={item.key} className="py-5 px-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug truncate">
                      {item.title || 'Untitled'}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {item.authors.length > 0 ? item.authors.join(', ') : 'Unknown'}
                    </p>
                    {item.attachments.length > 0 && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        {item.attachments.length} PDF{item.attachments.length > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {item.indexed ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                        <Check className="w-3 h-3" /> Indexed
                      </span>
                    ) : item.attachments.length > 0 ? (
                      <span className="text-xs text-gray-400">Not indexed</span>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">No PDF</span>
                    )}
                    {item.date && (
                      <span className="text-xs font-mono text-gray-400 dark:text-gray-500">{item.date.slice(0, 4)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
      <BookOpen className="w-10 h-10 mb-3" />
      <p className="font-medium">{title}</p>
      <p className="text-sm mt-1">{description}</p>
    </div>
  )
}
