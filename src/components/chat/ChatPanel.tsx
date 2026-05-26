/**
 * Chat panel component for ZoteroSeek
 * 包含错误边界、离线检测和流式生成控制
 */

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';
import { ErrorBoundary } from '../ErrorBoundary';
import { XulButton } from '../common/XulButton';
import { Icon } from '../common/Icon';
import { useChat } from '@/hooks/useChat';

/**
 * 离线状态提示横幅
 */
function OfflineBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-700">
      <Icon name="warning" className="h-4 w-4" />
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
      <XulButton
        onClick={onClick}
        className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-[#1f1f23] px-4 py-1.5 text-sm text-[#ececec] hover:bg-white/[0.04] focus:outline-none"
      >
        <Icon name="stop" className="h-3.5 w-3.5" />
        停止生成
      </XulButton>
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
        <div className="border-t border-white/[0.06] bg-[#111113] p-3">
          <InputBox onSend={handleSend} isLoading={isLoading} disabled={isOffline} />
        </div>
      </div>
    </ErrorBoundary>
  );
}
