import { useState } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import { Plus, MessageSquare, Trash2, Pencil, Check, X } from 'lucide-react'

interface Props {
  onNewChat: () => void
  onSelectSession: (id: string) => void
}

export default function SessionSidebar({ onNewChat, onSelectSession }: Props) {
  const { sessions, activeSessionId, deleteSession, renameSession, createSession } = useSessionStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const handleNew = () => {
    createSession()
    onNewChat()
  }

  const handleRename = (id: string) => {
    if (editTitle.trim()) {
      renameSession(id, editTitle.trim())
    }
    setEditingId(null)
  }

  const startEdit = (id: string, currentTitle: string) => {
    setEditingId(id)
    setEditTitle(currentTitle)
  }

  // 按更新时间排序
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="w-60 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col transition-colors">
      {/* 新建按钮 */}
      <div className="p-3">
        <button
          onClick={handleNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {sorted.map((session) => {
          const active = session.id === activeSessionId
          const editing = editingId === session.id

          return (
            <div
              key={session.id}
              onClick={() => !editing && onSelectSession(session.id)}
              className={`
                group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors
                ${active
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                }
              `}
            >
              <MessageSquare className="w-4 h-4 shrink-0 opacity-50" />

              {editing ? (
                <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(session.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="flex-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                  <button onClick={() => handleRename(session.id)} className="text-green-600 hover:text-green-700">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 truncate">{session.title}</span>
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(session.id, session.title) }}
                      className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Rename"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSession(session.id) }}
                      className="p-0.5 text-gray-400 hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}

        {sorted.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 text-xs py-8">
            No conversations yet
          </div>
        )}
      </div>
    </div>
  )
}
