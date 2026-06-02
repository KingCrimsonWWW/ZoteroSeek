import { useState } from 'react'
import { MessageSquare, Library as LibraryIcon, Search, BookOpen, Moon, Sun, PanelLeftClose, PanelLeft } from 'lucide-react'
import Chat from '@/views/Chat'
import Library from '@/views/Library'
import SearchView from '@/views/Search'
import SessionSidebar from '@/components/SessionSidebar'
import { useThemeStore } from '@/stores/themeStore'
import { useSessionStore } from '@/stores/sessionStore'

type View = 'chat' | 'library' | 'search'

const tabs: { id: View; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'search', label: 'Search', icon: Search },
]

function App() {
  const [view, setView] = useState<View>('chat')
  const { theme, toggleTheme } = useThemeStore()
  const { createSession, setActiveSession } = useSessionStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handleNewChat = () => {
    createSession()
    setView('chat')
  }

  const handleSelectSession = (id: string) => {
    setActiveSession(id)
    setView('chat')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors">
      {/* 顶部导航栏 */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 transition-colors">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14">
          {/* 侧边栏切换（仅 Chat 视图） */}
          {view === 'chat' && (
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="mr-3 p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeft className="w-5 h-5" />}
            </button>
          )}

          {/* 品牌 */}
          <div className="flex items-center gap-2 mr-8">
            <BookOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <span className="font-bold text-lg text-gray-900 dark:text-white">ZoteroSeek</span>
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
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* 右侧：深色模式切换 */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* 会话侧边栏（仅 Chat 视图） */}
        {view === 'chat' && sidebarOpen && (
          <SessionSidebar
            onNewChat={handleNewChat}
            onSelectSession={handleSelectSession}
          />
        )}

        <main className="flex-1 px-4 py-6">
          {view === 'chat' && <Chat />}
          {view === 'library' && <Library />}
          {view === 'search' && <SearchView />}
        </main>
      </div>
    </div>
  )
}

export default App
