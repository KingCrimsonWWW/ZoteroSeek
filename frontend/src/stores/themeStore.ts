/**
 * ThemeStore — 主题（亮/暗模式）状态管理
 *
 * 设计思路：
 * 使用 Zustand 管理主题状态，同时处理三个层面的同步：
 * 1. React 状态（store 中的 theme 变量）—— 驱动 UI 重渲染
 * 2. DOM classList（<html> 元素的 'dark' 类名）—— 驱动 Tailwind CSS 的 dark: 变体
 * 3. localStorage（持久化用户偏好）—— 跨会话保持选择
 *
 * 为什么用 Tailwind 的 class 策略而不是 media query 策略：
 * - Tailwind dark: 变体默认使用 prefers-color-scheme 媒体查询，
 *   但 class 策略（darkMode: 'class'）允许用户手动覆盖系统偏好
 * - 这是大多数产品的标准做法：尊重系统默认，但允许用户自定义
 *
 * 为什么在 store 外部（模块顶层）初始化而不是在组件中 useEffect 初始化：
 * - 模块顶层同步执行，避免了页面加载时的"白色闪烁"（FOUC）
 * - applyTheme() 在任何 React 组件渲染前就已经设置了正确的 class
 */
import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface ThemeState {
  /** 当前主题模式 */
  theme: Theme
  /** 切换亮/暗模式 */
  toggleTheme: () => void
}

/**
 * 获取初始主题的优先级：
 * 1. localStorage 中的用户偏好（最高优先级）
 * 2. 操作系统的 prefers-color-scheme 媒体查询（次优先级）
 * 3. 默认为 'light'（fallback）
 *
 * 这种"用户选择 > 系统偏好 > 默认值"的优先级链是主题系统的设计惯例
 */
function getInitialTheme(): Theme {
  const stored = localStorage.getItem('zoteroseek-theme')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 将主题应用到 DOM 和 localStorage
 * 为什么同时操作 DOM 和 localStorage：
 * - DOM classList：Tailwind 的 dark: 变体依赖 <html> 元素上的 'dark' 类名
 * - localStorage：持久化用户选择，下次打开页面时直接读取
 *
 * 为什么操作 document.documentElement 而不是 body：
 * - Tailwind 官方推荐在 <html> 上设置 dark class
 * - 这样 CSS 变量和 dark: 选择器都能正确级联
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  localStorage.setItem('zoteroseek-theme', theme)
}

// 模块加载时立即初始化主题，确保在 React 渲染树挂载前就设置好
// 这样可以避免页面首次绘制时出现错误的主题颜色
const initial = getInitialTheme()
applyTheme(initial)

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'light' ? 'dark' : 'light'
      // 同步更新 DOM 和 localStorage
      applyTheme(next)
      return { theme: next }
    })
  },
}))
