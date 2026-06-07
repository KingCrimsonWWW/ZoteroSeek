/**
 * Chat 视图 — 核心对话界面
 *
 * 设计思路：
 * 这是应用的主视图，负责渲染消息列表、处理用户输入、展示 AI 回复。
 * 组件本身是"无状态"的（除了 UI 局部状态如 input），所有业务状态
 * 通过 Zustand store 管理。
 *
 * 关键技术点：
 * 1. Markdown 渲染：AI 回复使用 ReactMarkdown + remark-gfm 解析
 * 2. 自动滚动：新消息到达时自动滚动到底部
 * 3. 自适应 textarea：输入框高度随内容自动扩展（最高 150px）
 * 4. 流式打字机效果：空 content 显示 Thinking 动画，有 content 时实时渲染
 * 5. Sources 面板：可折叠的引用源卡片，展示 RAG 检索的来源文献
 */
import { useChatStore } from '@/stores/chatStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useState, useRef, useEffect } from 'react'
import { Send, Copy, Check, FileText, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatSource } from '@/api/client'

export default function Chat() {
  const { isLoading, sendMessage } = useChatStore()
  // 从 sessionStore 选择性订阅活跃会话
  // 使用选择器函数 (s) => s.getActiveSession() 可以避免无关状态变化触发重渲染
  // 注意：getActiveSession() 每次调用都返回新引用，这里可接受因为会话数据变化频率低
  const activeSession = useSessionStore((s) => s.getActiveSession())
  const deleteMessagesFromIndex = useSessionStore((s) => s.deleteMessagesFromIndex)
  const messages = activeSession?.messages ?? []
  const [input, setInput] = useState('')

  // messagesEndRef：指向消息列表末尾的 DOM 元素，用于自动滚动
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // textareaRef：指向输入框，用于在提交后重置高度
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /**
   * 自动滚动到底部
   * 依赖 messages 数组：每次消息列表变化（新增、更新）都触发滚动
   * behavior: 'smooth' 提供平滑滚动动画
   *
   * 为什么用 ref + scrollIntoView 而不是在容器上用 overflow-anchor：
   * - scrollIntoView 更可靠，尤其在流式更新时
   * - overflow-anchor 在某些浏览器中对频繁 DOM 变动的表现不稳定
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /**
   * 表单提交处理
   * 防重复发送：isLoading 期间禁用提交
   * 提交后立即清空输入框并重置高度
   */
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

  /**
   * 键盘快捷键处理
   * Enter 发送，Shift+Enter 换行
   * 这是所有主流聊天应用的标准交互模式
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  /**
   * 自动调整 textarea 高度
   * 技巧：先设为 'auto' 重置，再设为 scrollHeight
   * 这样 textarea 能根据内容自动收缩和扩展
   * 最大高度 150px，超过后出现滚动条，避免输入框占据过多空间
   */
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* 消息列表 — 滚动条在页面最右侧 */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-4">

        {/* 空状态引导：没有消息时显示欢迎界面 */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
            <FileText className="w-12 h-12 mb-3" />
            <p className="text-lg font-medium text-gray-500 dark:text-gray-400">ZoteroSeek AI Assistant</p>
            <p className="text-sm mt-1 text-gray-400 dark:text-gray-500">Ask questions about your research papers</p>
          </div>
        )}

        {/* 消息列表渲染 */}
        {messages.map((msg, i) => (
          <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-1' : ''}`}>
              {/* 消息气泡样式设计：
                  - 用户消息：蓝色背景，右下角方角（rounded-br-md）
                  - AI 消息：白/深色背景，左下角方角，带边框和阴影
                  方角设计暗示消息的发送方向，是聊天 UI 的常见视觉语言 */}
              <div
                className={`p-4 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-bl-md shadow-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  // 用户消息：纯文本渲染，保留换行符
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                ) : msg.content ? (
                  /**
                   * AI 消息：使用 ReactMarkdown 渲染 Markdown
                   *
                   * 为什么选择 ReactMarkdown：
                   * - 基于 unified 生态（remark/rehype），插件丰富
                   * - remark-gfm 支持 GitHub 风格 Markdown（表格、任务列表、删除线等）
                   * - 比 dangerouslySetInnerHTML 安全得多（内置 XSS 防护）
                   *
                   * Tailwind Typography (prose) 类：
                   * - prose 类自动为 Markdown 生成的 HTML 元素添加排版样式
                   * - dark:prose-invert 在暗色模式下反转颜色
                   * - prose-sm 使用较小的基础字号，适合聊天场景
                   * - prose-p:my-1 等覆盖默认间距，使其更紧凑
                   */
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  /**
                   * Thinking 状态动画
                   * 当 content 为空字符串时显示（即 assistant 占位消息已创建
                   * 但尚未收到第一个 chunk）。三个脉冲圆点的动画延迟递增
                   * 创建波浪效果。
                   */
                  <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse [animation-delay:0.4s]" />
                    </div>
                    <span className="text-xs">Thinking...</span>
                  </div>
                )}
              </div>

              {/* 用户消息操作按钮：复制 / 编辑（编辑后重新发送） */}
              {msg.role === 'user' && (
                <div className="flex justify-end gap-1 mt-1">
                  <CopyButton text={msg.content} />
                  <button
                    onClick={() => {
                      setInput(msg.content)
                      // 从这条消息开始删除后续所有消息，编辑后可重新发送
                      deleteMessagesFromIndex(i)
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    title="Edit and resend"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                </div>
              )}

              {/* 引用源面板：仅 AI 消息且有 sources 时显示 */}
              {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                <SourcesPanel sources={msg.sources} />
              )}

              {/* 复制按钮：仅 AI 消息且有内容时显示 */}
              {msg.role === 'assistant' && msg.content && (
                <CopyButton text={msg.content} />
              )}
            </div>
          </div>
        ))}

        {/* 滚动锚点：一个空的 div，auto-scroll 的目标元素 */}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入区 — 悬浮式设计（底部固定，不随消息滚动） */}
      <div className="px-6 pb-4 pt-2">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            {/**
             * 输入框容器 — Liquid Glass 玻璃拟态风格
             *
             * 设计要点：
             * - backdrop-blur-2xl：毛玻璃背景模糊效果
             * - bg-white/60：半透明白色，让背景隐约可见
             * - border-white/30：极淡的白色边框增强玻璃质感
             * - shadow-xl：较重的阴影营造浮起感
             * - focus-within:ring-2：聚焦时的蓝色光晕指示器
             *
             * 为什么用 focus-within 而不是在 textarea 上直接设置 ring：
             * - focus-within 在容器（包括发送按钮区域）上显示光晕
             * - 视觉上将整个输入区域视为一个整体
             */}
            <div className="flex-1 flex items-end gap-2 rounded-2xl border border-white/30 dark:border-gray-600/50 bg-white/60 dark:bg-gray-800/60 backdrop-blur-2xl shadow-xl shadow-black/[0.03] dark:shadow-black/20 focus-within:ring-2 focus-within:ring-blue-400/40 focus-within:border-blue-300/50 dark:focus-within:border-blue-500/30 transition-all pr-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your research..."
                className="flex-1 resize-none bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-4 py-3 text-sm focus:outline-none max-h-[150px]"
                rows={1}
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-2 mb-1.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/**
 * SourcesPanel 组件 — 引用源面板
 *
 * 设计思路：
 * 展示 RAG（检索增强生成）过程中引用的文献来源。
 * 默认折叠，用户点击后展开查看详情。
 *
 * 为什么做成可折叠的：
 * - 避免信息过载：大多数用户首先关注的是 AI 的回答文本
 * - 参考学术写作规范：参考文献放在文末，按需查阅
 * - 折叠状态下只显示"N sources referenced"，简洁不干扰
 */
function SourcesPanel({ sources }: { sources: ChatSource[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-1"
      >
        <FileText className="w-3 h-3" />
        {sources.length} source{sources.length > 1 ? 's' : ''} referenced
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {sources.map((src) => (
            <div
              key={src.index}
              className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-3 text-xs"
            >
              <div className="mb-1">
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate block">
                  [{src.index}] {src.title}
                </span>
              </div>
              {src.section && (
                <span className="text-gray-500 text-[10px] uppercase tracking-wider">
                  {src.section}
                </span>
              )}
              {/* line-clamp-2：限制最多显示 2 行，超出部分用省略号 */}
              <p className="text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">{src.content_preview}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * CopyButton 组件 — 一键复制 AI 回复
 *
 * 使用 Clipboard API (navigator.clipboard.writeText) 复制文本
 * 复制后显示 2 秒的 "Copied" 确认状态，然后自动恢复
 *
 * 为什么用局部 useState 而不是全局状态：
 * - "已复制"是纯 UI 反馈，不影响业务逻辑
 * - 每个消息气泡独立拥有自己的 CopyButton 实例，互不干扰
 */
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
