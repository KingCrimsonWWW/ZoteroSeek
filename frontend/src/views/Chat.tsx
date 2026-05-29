import { useChatStore } from '@/stores/chatStore'
import { useState } from 'react'

export default function Chat() {
  const { messages, isLoading, sendMessage } = useChatStore()
  const [input, setInput] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    setInput('')
    await sendMessage(input)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`p-4 rounded-lg ${
              msg.role === 'user' ? 'bg-blue-100 ml-auto max-w-[80%]' : 'bg-white max-w-[80%]'
            }`}
          >
            <p className="text-sm">{msg.content}</p>
          </div>
        ))}
        {isLoading && (
          <div className="bg-white p-4 rounded-lg max-w-[80%]">
            <p className="text-sm text-gray-500">Thinking...</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your research..."
          className="flex-1 p-3 border rounded-lg"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-6 py-3 bg-blue-500 text-white rounded-lg disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}
