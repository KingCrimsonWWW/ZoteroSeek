/**
 * 最小 React 类型声明。
 *
 * 为什么自己声明：Client 半边运行在 DSH 的浏览器模块表里，`react` 由宿主提供，
 * 本仓库不安装也不打包 React。为了让 `tsc --noEmit` 能在没有 @types/react 的
 * 情况下检查我们自己的代码，这里只声明实际用到的 11 个符号。
 */
declare module 'react' {
  export interface CSSProperties {
    [key: string]: string | number | undefined
  }

  export type ReactNode = unknown

  export interface ReactElement {
    type: unknown
    props: unknown
  }

  export interface ChangeEventLike<T = string> {
    target: { value: T }
  }

  export interface KeyboardEventLike {
    key: string
  }

  export function createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): ReactElement

  export const Fragment: unknown

  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((current: S) => S)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  export function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]): T
  export function useRef<T>(initial: T | null): { current: T | null }
}
