/**
 * ErrorBoundary - React 错误边界组件
 * 捕获子组件树中的 JavaScript 错误，显示友好的错误提示
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './common/Icon';
import { XulButton } from './common/XulButton';
import { ThemeContext } from '@/hooks/useTheme';

interface ErrorBoundaryProps {
  /** 子组件 */
  children: ReactNode;
  /** 可选的自定义回退 UI */
  fallback?: ReactNode;
  /** 错误发生时的回调 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  /** 是否有错误 */
  hasError: boolean;
  /** 捕获的错误 */
  error: Error | null;
}

/**
 * 错误边界组件
 * 捕获渲染过程中的错误，防止整个应用崩溃
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 调用可选的错误回调
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // 如果提供了自定义回退 UI，使用它
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 默认错误 UI
      return (
        <ThemeContext.Consumer>
          {({ dark }) => (
            <div className={`flex h-full flex-col items-center justify-center p-6 text-center ${dark ? 'bg-[#111113]' : 'bg-white'}`}>
              {/* 错误图标 */}
              <Icon name="alert" className="mb-4 h-16 w-16 text-red-400" />

              {/* 错误标题 */}
              <h3 className={`mb-2 text-lg font-medium ${dark ? 'text-[#ececec]' : 'text-gray-900'}`}>
                出现了一些问题
              </h3>

              {/* 错误描述 */}
              <p className={`mb-1 text-sm ${dark ? 'text-[#888]' : 'text-gray-500'}`}>
                {this.state.error?.message || '发生了未知错误'}
              </p>
              <p className={`mb-6 text-xs ${dark ? 'text-[#666]' : 'text-gray-400'}`}>
                请尝试重新加载，如果问题持续存在，请检查网络连接或 API 配置。
              </p>

              {/* 重试按钮 */}
              <XulButton
                onClick={this.handleReset}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                重新加载
              </XulButton>
            </div>
          )}
        </ThemeContext.Consumer>
      );
    }

    return this.props.children;
  }
}
