/**
 * Chat panel component for ZoteroSeek
 * 包含错误边界、离线检测和流式生成控制
 */

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';
import { ErrorBoundary } from '../ErrorBoundary';
import { useChat } from '../../hooks/useChat';

/**
 * 离线状态提示横幅
 */
function OfflineBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-700">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a5 5 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3"
        />
      </svg>
      <span>网络连接已断开，消息发送功能暂时不可用</span>
    </div>
  );
}

/**
 * 停止生成按钮
 */
function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center py-2">
      <button
        onClick={onClick}
        className="flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        停止生成
      </button>
    </div>
  );
}

export function ChatPanel() {
  const { messages, isLoading, sendMessage, stopGeneration } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // 监听网络状态变化
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      // 离线时阻止发送
      if (isOffline) {
        return;
      }

      await sendMessage(content);
      // Scroll to bottom after sending
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 100);
    },
    [sendMessage, isOffline],
  );

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col">
        {/* 离线提示 */}
        {isOffline && <OfflineBanner />}

        {/* Messages area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          <MessageList messages={messages} isLoading={isLoading} />
        </div>

        {/* 停止生成按钮 */}
        {isLoading && <StopButton onClick={stopGeneration} />}

        {/* Input area */}
        <div className="border-t border-gray-200 bg-white p-3">
          <InputBox onSend={handleSend} isLoading={isLoading} disabled={isOffline} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
