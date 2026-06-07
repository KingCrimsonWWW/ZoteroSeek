/**
 * App 根组件 — 应用外壳与导航
 *
 * 设计思路：
 * App 组件是整个应用的外壳（shell），负责：
 * 1. 顶部导航栏（Liquid Glass 玻璃拟态风格）
 * 2. Tab 切换与流动指示器动画
 * 3. 会话侧边栏的展开/收起动画
 * 4. Zotero 连接状态检测
 * 5. 深色模式切换
 *
 * 架构决策：
 * - 路由使用简单的状态驱动（useState<View>）而非 React Router
 *   原因：只有 3 个 tab，无需 URL 路由、懒加载等开销
 * - 侧边栏通过 CSS width 动画实现展开/收起，而非条件渲染
 *   原因：width: 0 -> w-64 的过渡动画比 mount/unmount 更流畅
 */
import { useState, useEffect, useRef } from 'react'
import { MessageSquare, Library as LibraryIcon, Search, Moon, Sun, PanelLeftClose, PanelLeft } from 'lucide-react'
import Chat from '@/views/Chat'
import Library from '@/views/Library'
import SearchView from '@/views/Search'
import SessionSidebar from '@/components/SessionSidebar'
import { useThemeStore } from '@/stores/themeStore'
import { useSessionStore } from '@/stores/sessionStore'

/** 视图类型：聊天 / 文献库 / 搜索 */
type View = 'chat' | 'library' | 'search'

/** 导航标签配置 */
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

  /** Zotero 连接状态：'checking' 为初始加载态 */
  const [zoteroStatus, setZoteroStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking')

  /**
   * Tab 流动指示器的实现
   *
   * 核心思路：
   * 1. 用 ref Map 存储每个 tab 按钮的 DOM 引用
   * 2. 当活跃 tab 变化时，计算对应按钮相对于父容器的位置（left）和宽度
   * 3. 用 CSS transition 驱动指示器的平滑移动
   *
   * 为什么用 absolute 定位 + 计算宽度而不是用 CSS transform：
   * - 每个 tab 按钮宽度可能不同（文字长度差异），需要动态计算
   * - absolute 定位可以直接设置 left 和 width，语义清晰
   * - cubic-bezier(0.4,0,0.2,1) 是 Material Design 的标准缓动曲线，
   *   提供快速启动、缓慢减速的自然动画效果
   */
  const tabRefs = useRef<Map<View, HTMLButtonElement>>(new Map())
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

  useEffect(() => {
    const el = tabRefs.current.get(view)
    if (el) {
      const parent = el.parentElement
      if (parent) {
        // getBoundingClientRect() 获取元素相对于视口的精确位置
        // 通过子元素减去父元素的 left 值，得到相对于父容器的偏移
        const parentRect = parent.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        setIndicatorStyle({
          left: elRect.left - parentRect.left,
          width: elRect.width,
        })
      }
    }
  }, [view])

  /**
   * 定期检查 Zotero 桌面客户端的连接状态
   *
   * 策略：
   * - 立即检查一次（组件挂载时）
   * - 之后每 30 秒轮询一次
   * - 通过 /api/v1/zotero-items 接口的 zotero_connected 字段判断
   * - 组件卸载时清除定时器（防止内存泄漏）
   *
   * 为什么用轮询而不是 WebSocket：
   * - Zotero 连接状态变化频率极低（用户启动/关闭 Zotero 桌面客户端）
   * - 30 秒轮询足够，不需要实时推送的复杂度
   */
  useEffect(() => {
    const checkZotero = async () => {
      try {
        const resp = await fetch('/api/v1/zotero-items')
        const data = await resp.json()
        setZoteroStatus(data.zotero_connected ? 'connected' : 'disconnected')
      } catch {
        setZoteroStatus('disconnected')
      }
    }
    checkZotero()
    const interval = setInterval(checkZotero, 30000)
    return () => clearInterval(interval)
  }, [])

  /** 新建聊天：创建会话并切换到聊天视图 */
  const handleNewChat = () => {
    createSession()
    setView('chat')
  }

  /** 选择已有会话：激活会话并切换到聊天视图 */
  const handleSelectSession = (id: string) => {
    setActiveSession(id)
    setView('chat')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors">
      {/**
       * 顶部导航栏 — Liquid Glass（液态玻璃）风格
       *
       * 这是 iOS 26 / macOS 26 引入的设计语言，核心特征：
       * - backdrop-blur-xl：背景模糊（毛玻璃效果）
       * - bg-white/70：半透明白色，背景内容隐约可见
       * - border-white/20：极淡的白色边框模拟玻璃折射边缘
       * - rounded-2xl：大圆角，柔和的视觉感受
       * - shadow-lg shadow-black/5：微妙的阴影营造浮层感
       *
       * 整体效果：导航栏像一块悬浮在内容上方的半透明玻璃板
       */}
      <nav className="sticky top-0 z-20">
        <div className="mx-3 mt-2">
          <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl border border-white/20 dark:border-gray-700/50 rounded-2xl shadow-lg shadow-black/5 dark:shadow-black/20 px-4 flex items-center h-14">
            {/**
             * 侧边栏切换按钮
             *
             * 动画实现：通过 width 从 w-8 到 w-0 的过渡实现"推出/推入"效果
             * 仅在 chat 视图显示侧边栏按钮（其他视图无会话列表）
             * overflow-hidden 配合 width: 0 确保按钮完全隐藏不占空间
             */}
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${view === 'chat' ? 'w-8 mr-2' : 'w-0 mr-0'}`}>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
                title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              >
                {sidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeft className="w-5 h-5" />}
              </button>
            </div>

            {/* 品牌标识：图标 + 文字（小屏隐藏文字只显示图标） */}
            <div className="flex items-center gap-2 mr-6">
              <img src="/icon.png" alt="ZoteroSeek" className="w-7 h-7 rounded-lg" />
              <span className="font-bold text-lg text-gray-900 dark:text-white hidden sm:block">ZoteroSeek</span>
            </div>

            {/**
             * 导航标签组 — 带流动指示器
             *
             * 整体结构：
             * <div>  ← 灰色胶囊容器（rounded-xl p-1）
             *   <div />  ← 流动指示器（absolute 定位，在标签下方流动）
             *   <button />  ← 各个标签按钮（relative z-10 在指示器上方）
             *   <button />
             * </div>
             *
             * z-10 确保按钮在指示器上方，否则会被 absolute 元素遮挡点击事件
             */}
            <div className="relative flex items-center bg-gray-100/60 dark:bg-gray-700/40 rounded-xl p-1">
              {/* 流动指示器：absolute 定位，通过 left/width 动画跟随活跃标签 */}
              <div
                className="absolute top-1 bottom-1 rounded-lg bg-white/90 dark:bg-gray-600/90 shadow-sm backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                style={{
                  left: indicatorStyle.left,
                  width: indicatorStyle.width,
                }}
              />

              {tabs.map((tab) => {
                const Icon = tab.icon
                const active = view === tab.id
                return (
                  <button
                    key={tab.id}
                    // 回调 ref：将 DOM 元素存入 Map，供 useEffect 计算指示器位置
                    ref={(el) => { if (el) tabRefs.current.set(tab.id, el) }}
                    onClick={() => setView(tab.id)}
                    className={`
                      relative z-10 flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors duration-200
                      ${active
                        ? 'text-gray-900 dark:text-white'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                      }
                    `}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* 右侧区域：Zotero 连接状态指示灯 + 深色模式切换 */}
            <div className="ml-auto flex items-center gap-3">
              {/* Zotero 连接状态指示灯
                  三种状态对应三种颜色：
                  - connected（绿色）：带绿色光晕，表示 Zotero 客户端在线
                  - disconnected（红色）：Zotero 未运行或连接断开
                  - checking（黄色脉冲）：正在检查，等待首次响应 */}
              <div className="flex items-center gap-1.5 text-xs" title={
                zoteroStatus === 'connected' ? 'Zotero connected' :
                zoteroStatus === 'disconnected' ? 'Zotero not running' : 'Checking...'
              }>
                <span className={`w-2 h-2 rounded-full transition-colors ${
                  zoteroStatus === 'connected' ? 'bg-green-500 shadow-sm shadow-green-400/50' :
                  zoteroStatus === 'disconnected' ? 'bg-red-400' :
                  'bg-yellow-400 animate-pulse'
                }`} />
                <span className="text-gray-500 dark:text-gray-400 hidden sm:inline">Zotero</span>
              </div>

              {/* 深色模式切换按钮
                  图标根据当前主题切换：暗色模式下显示太阳（点击切亮），亮色模式下显示月亮（点击切暗）
                  这是业界通用的图标隐喻：显示"可以切换到的目标状态"而非当前状态 */}
              <button
                onClick={toggleTheme}
                className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容区：侧边栏 + 主视图 */}
      <div className="flex-1 flex overflow-hidden mt-1">
        {/**
         * 会话侧边栏
         *
         * 动画实现策略：CSS width 过渡
         * - 展开时：width: w-64（256px）
         * - 收起时：width: w-0（0px）
         * - overflow-hidden 确保收起时内容不可见
         * - transition-all duration-300 提供平滑过渡
         *
         * 为什么用 width 动画而不是 transform: translateX(-100%)：
         * - width 动画会推动右侧主内容区跟随移动，产生"推入/推出"效果
         * - transform 只是视觉位移，不会影响布局流，主内容区不会移动
         * - "推入"效果更符合侧边栏的物理直觉
         *
         * 仅在 chat 视图 + sidebarOpen 时展开
         */}
        <div className={`transition-all duration-300 ease-in-out ${view === 'chat' && sidebarOpen ? 'w-64' : 'w-0'} overflow-hidden shrink-0`}>
          <SessionSidebar onNewChat={handleNewChat} onSelectSession={handleSelectSession} />
        </div>

        <main className="flex-1 overflow-hidden flex flex-col">
          {/**
           * 视图渲染策略
           *
           * 为什么 Chat 用条件显示（而非仅在 view === 'chat' 时渲染）：
           * - Chat 组件始终挂载可以保持消息状态和滚动位置
           * - 但实际上这里用的是 {view === 'chat' && <Chat />}，
           *   切换视图时 Chat 会被卸载，这在当前架构下是可接受的，
           *   因为所有状态都存在 Zustand store 中，重新挂载时自动恢复
           *
           * Library 和 Search 使用公共的滚动容器包裹，限制最大宽度
           */}
          {view === 'chat' && <Chat />}
          {view !== 'chat' && (
            <div className="w-full overflow-y-auto h-[calc(100vh-72px)]">
              <div className="max-w-4xl mx-auto px-4 py-6">
                {view === 'library' && <Library />}
                {view === 'search' && <SearchView />}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
