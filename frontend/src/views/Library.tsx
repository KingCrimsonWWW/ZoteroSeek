import { useEffect, useState } from 'react'
import { apiClient } from '@/api/client'

interface Item {
  id: string
  title: string
  authors: string
  year: number
  index_status: string
}

export default function Library() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiClient.library().then(res => {
      setItems(res.data.items)
      setLoading(false)
    })
  }, [])

  if (loading) return <div>Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Library</h2>
      {items.length === 0 ? (
        <p className="text-gray-500">No items indexed yet. Use the API to index PDFs.</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-lg shadow">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm text-gray-600">{item.authors} ({item.year})</p>
              <span className={`text-xs px-2 py-1 rounded ${
                item.index_status === 'indexed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {item.index_status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
