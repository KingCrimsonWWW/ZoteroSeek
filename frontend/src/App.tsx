import { useState } from 'react'
import Chat from '@/views/Chat'
import Library from '@/views/Library'
import Search from '@/views/Search'

type View = 'chat' | 'library' | 'search'

function App() {
  const [view, setView] = useState<View>('chat')

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex gap-4">
          <button
            onClick={() => setView('chat')}
            className={`px-4 py-2 rounded ${view === 'chat' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Chat
          </button>
          <button
            onClick={() => setView('library')}
            className={`px-4 py-2 rounded ${view === 'library' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Library
          </button>
          <button
            onClick={() => setView('search')}
            className={`px-4 py-2 rounded ${view === 'search' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Search
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {view === 'chat' && <Chat />}
        {view === 'library' && <Library />}
        {view === 'search' && <Search />}
      </main>
    </div>
  )
}

export default App
