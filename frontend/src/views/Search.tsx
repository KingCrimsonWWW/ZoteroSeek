import { useState } from 'react'
import { apiClient, type SearchResult } from '@/api/client'

export default function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    try {
      const res = await apiClient.search(query)
      setResults(res.data.results)
    } catch (err) {
      // handle error silently
    }
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Semantic Search</h2>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your knowledge base..."
          className="flex-1 p-3 border rounded-lg"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-blue-500 text-white rounded-lg disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {results.length > 0 && (
        <div className="space-y-4">
          {results.map(result => (
            <div key={result.id} className="bg-white p-4 rounded-lg shadow">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium text-blue-600">
                  {(result.metadata.title as string) || 'Unknown'}
                </span>
                <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                  Score: {result.score.toFixed(2)}
                </span>
              </div>
              <p className="text-sm text-gray-700">{result.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
