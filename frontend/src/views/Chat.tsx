import { useChatStore } from '@/stores/chatStore'
import { useState, useRef, useEffect } from 'react'
import { Send, Trash2, Copy, Check, FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatSource } from '@/api/client'

export default function Chat() {
  const { messages, isLoading, sendMessage, clearMessages } = useChatStore()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    setInput('')
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    await sendMessage(input)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // 自动调整 textarea 高度
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <FileText className="w-12 h-12 mb-3" />
            <p className="text-lg font-medium">ZoteroSeek AI Assistant</p>
            <p className="text-sm mt-1">Ask questions about your research papers</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-1' : ''}`}>
              {/* 消息气泡 */}
              <div
                className={`p-4 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-white border border-gray-200 rounded-bl-md shadow-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>

              {/* 来源卡片 */}
              {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                <SourcesPanel sources={msg.sources} />
              )}

              {/* 复制按钮 */}
              {msg.role === 'assistant' && msg.content && (
                <CopyButton text={msg.content} />
              )}
            </div>
          </div>
        ))}

        {/* 加载动画 */}
        {isLoading && messages[messages.length - 1]?.content === '' && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md p-4 shadow-sm">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="border-t border-gray-200 bg-white p-4 -mx-4 -mb-6 rounded-b-lg">
        <div className="flex items-end gap-3">
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors shrink-0"
              title="Clear chat"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}

          <form onSubmit={handleSubmit} className="flex-1 flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your research... (Shift+Enter for new line)"
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-[150px]"
              rows={1}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

/** 来源面板 */
function SourcesPanel({ sources }: { sources: ChatSource[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
      >
        <FileText className="w-3 h-3" />
        {sources.length} source{sources.length > 1 ? 's' : ''} referenced
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {sources.map((src) => (
            <div
              key={src.index}
              className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-medium text-gray-900 truncate">
                  [{src.index}] {src.title}
                </span>
                <span className="shrink-0 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">
                  {(src.score * 100).toFixed(0)}%
                </span>
              </div>
              {src.section && (
                <span className="text-gray-500 text-[10px] uppercase tracking-wider">
                  {src.section}
                </span>
              )}
              <p className="text-gray-600 mt-1 line-clamp-2">{src.content_preview}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 复制按钮 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="mt-1 text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" /> Copy
        </>
      )}
    </button>
  )
}
