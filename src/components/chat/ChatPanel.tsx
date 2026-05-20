/**
 * Chat panel component for ZoteroSeek
 */

import React, { useState, useRef, useCallback } from 'react';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';
import { useChat } from '../../hooks/useChat';

export function ChatPanel() {
  const { messages, isLoading, sendMessage, clearMessages } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSend = useCallback(
    async (content: string) => {
      await sendMessage(content);
      // Scroll to bottom after sending
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 100);
    },
    [sendMessage],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <MessageList messages={messages} isLoading={isLoading} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white p-3">
        <InputBox onSend={handleSend} isLoading={isLoading} />
      </div>
    </div>
  );
}
