import { useState } from 'react'
import { apiClient, type SearchResult } from '@/api/client'
import { Search as SearchIcon, AlertCircle, FileText } from 'lucide-react'

export default function SearchView() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const res = await apiClient.search(query)
      setResults(res.data.results)
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败，请确保后端已启动')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* 搜索栏 */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your knowledge base..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {/* 错误状态 */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* 搜索结果 */}
      {results.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-3">
            Found {results.length} result{results.length > 1 ? 's' : ''}
          </p>
          <div className="space-y-3">
            {results.map((result) => (
              <div
                key={result.id}
                className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all"
              >
                <div className="mb-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 block truncate">
                    {String(result.metadata.title || 'Unknown')}
                  </span>
                  {typeof result.metadata.section_type === 'string' && result.metadata.section_type && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {result.metadata.section_type}
                    </span>
                  )}
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">{result.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 无结果 */}
      {searched && !loading && results.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <FileText className="w-10 h-10 mb-3" />
          <p className="font-medium">No results found</p>
          <p className="text-sm mt-1">Try a different search query or index more papers</p>
        </div>
      )}

      {/* 初始状态 */}
      {!searched && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          <SearchIcon className="w-10 h-10 mb-3" />
          <p className="font-medium text-gray-500 dark:text-gray-400">Semantic Search</p>
          <p className="text-sm mt-1">Search across all indexed papers using natural language</p>
        </div>
      )}
    </div>
  )
}
