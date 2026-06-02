import { useState } from 'react'
import { MessageSquare, Library as LibraryIcon, Search, BookOpen } from 'lucide-react'
import Chat from '@/views/Chat'
import Library from '@/views/Library'
import SearchView from '@/views/Search'

type View = 'chat' | 'library' | 'search'

const tabs: { id: View; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'search', label: 'Search', icon: Search },
]

function App() {
  const [view, setView] = useState<View>('chat')

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 顶部导航栏 */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 flex items-center h-14">
          {/* 品牌 */}
          <div className="flex items-center gap-2 mr-8">
            <BookOpen className="w-6 h-6 text-blue-600" />
            <span className="font-bold text-lg text-gray-900">ZoteroSeek</span>
          </div>

          {/* 导航标签 */}
          <div className="flex gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = view === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setView(tab.id)}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                    ${active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {view === 'chat' && <Chat />}
        {view === 'library' && <Library />}
        {view === 'search' && <SearchView />}
      </main>
    </div>
  )
}

export default App
