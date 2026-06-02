import { useEffect, useState, useCallback } from 'react'
import { apiClient, type ZoteroItem, type IndexResult } from '@/api/client'
import { BookOpen, Download, Check, AlertCircle, Loader2, RefreshCw } from 'lucide-react'

interface IndexedItem {
  id: string
  title: string
  authors: string
  year: number
  index_status: string
}

type Tab = 'indexed' | 'zotero'

export default function Library() {
  const [tab, setTab] = useState<Tab>('indexed')
  const [indexedItems, setIndexedItems] = useState<IndexedItem[]>([])
  const [zoteroItems, setZoteroItems] = useState<ZoteroItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [indexResults, setIndexResults] = useState<IndexResult[] | null>(null)

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
    try {
      const res = await apiClient.indexZotero(undefined, 'mineru')
      setIndexResults(res.data.results)
      // 刷新列表
      await loadZotero()
      await loadIndexed()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量索引失败')
    } finally {
      setIndexing(false)
    }
  }

  return (
    <div>
      {/* 标签栏 + 操作按钮 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setTab('indexed')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'indexed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
            }`}
          >
            <BookOpen className="w-4 h-4 inline mr-1.5" />
            Indexed ({indexedItems.length})
          </button>
          <button
            onClick={() => setTab('zotero')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'zotero' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
            }`}
          >
            <Download className="w-4 h-4 inline mr-1.5" />
            Zotero Library
          </button>
        </div>

        {tab === 'zotero' && (
          <button
            onClick={handleBatchIndex}
            disabled={indexing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {indexing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {indexing ? 'Indexing...' : 'Index All PDFs'}
          </button>
        )}

        {tab === 'indexed' && (
          <button
            onClick={loadIndexed}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 索引结果提示 */}
      {indexResults && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
          <Check className="w-4 h-4 inline text-green-600 mr-1" />
          索引完成：{indexResults.filter(r => r.success).length} 成功，
          {indexResults.filter(r => !r.success).length} 失败
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-800 font-medium">{error}</p>
            <button
              onClick={() => { setError(null); tab === 'indexed' ? loadIndexed() : loadZotero() }}
              className="text-xs text-red-600 hover:text-red-800 mt-1 underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* 加载骨架屏 */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white p-4 rounded-lg border border-gray-200 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Indexed 列表 */}
      {!loading && tab === 'indexed' && (
        indexedItems.length === 0 ? (
          <EmptyState
            title="No indexed papers yet"
            description="Go to the Zotero Library tab to index PDFs from your Zotero collection."
          />
        ) : (
          <div className="space-y-2">
            {indexedItems.map(item => (
              <div
                key={item.id}
                className="bg-white p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <h3 className="font-medium text-gray-900 text-sm">{item.title}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {item.authors} {item.year ? `(${item.year})` : ''}
                </p>
                <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full ${
                  item.index_status === 'indexed'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {item.index_status}
                </span>
              </div>
            ))}
          </div>
        )
      )}

      {/* Zotero 列表 */}
      {!loading && tab === 'zotero' && (
        zoteroItems.length === 0 ? (
          <EmptyState
            title="No items found"
            description="Make sure Zotero is running and has items in your library."
          />
        ) : (
          <div className="space-y-2">
            {zoteroItems.map(item => (
              <div
                key={item.key}
                className="bg-white p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 text-sm truncate">{item.title || 'Untitled'}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.authors.length > 0 ? item.authors.join(', ') : 'Unknown author'}
                      {item.date ? ` · ${item.date.slice(0, 4)}` : ''}
                    </p>
                    {item.attachments.length > 0 && (
                      <p className="text-xs text-blue-600 mt-1">
                        📎 {item.attachments.length} PDF{item.attachments.length > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {item.indexed ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full">
                        <Check className="w-3 h-3" /> Indexed
                      </span>
                    ) : item.attachments.length > 0 ? (
                      <span className="text-xs text-gray-400">Not indexed</span>
                    ) : (
                      <span className="text-xs text-gray-300">No PDF</span>
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
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <BookOpen className="w-10 h-10 mb-3" />
      <p className="font-medium">{title}</p>
      <p className="text-sm mt-1">{description}</p>
    </div>
  )
}
