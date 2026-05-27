/**
 * Message list component for ZoteroSeek
 * 支持错误消息特殊样式和空状态占位符
 */

import React from 'react';
import { Message } from '../../typings';
import { Icon } from '../common/Icon';
import { XulButton } from '../common/XulButton';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

/**
 * 判断消息是否为错误消息
 */
function isError(message: Message): boolean {
  return message.metadata?.isError === true;
}

/** Suggested actions for the welcome screen */
const SUGGESTED_ACTIONS = [
  'Summarize Papers',
  'Find Related Work',
  'Explain Equations',
  'Organize Notes',
];

export function MessageList({ messages, isLoading }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center pt-12">
        <div className="text-center">
          <Icon name="chat" className="mx-auto mb-4 h-12 w-12 text-[#888]" />
          <p className="text-[15px] text-[#888]">Ask ZoteroSeek about your papers, notes, and research.</p>

          {/* Suggested action buttons */}
          <div className="grid grid-cols-2 gap-2 mt-4 max-w-[400px] mx-auto">
            {SUGGESTED_ACTIONS.map((action) => (
              <XulButton
                key={action}
                className="border border-white/[0.06] rounded-lg px-4 py-2 text-[13px] text-[#888] hover:bg-white/[0.04] hover:text-[#ececec] transition-colors duration-150 cursor-pointer"
              >
                {action}
              </XulButton>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const isErrorMessage = isError(message);

        return (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                isErrorMessage
                  ? 'border border-red-200 bg-red-50 text-red-700'
                  : message.role === 'user'
                    ? 'bg-[rgba(91,127,255,0.12)] text-[#ececec]'
                    : 'bg-[#1f1f23] text-[#ececec]'
              }`}
            >
              {/* 错误消息显示图标 */}
              {isErrorMessage && (
                <Icon name="error" className="mb-1 inline-block h-4 w-4 text-red-500" />
              )}
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
              <p className="mt-1 text-xs opacity-70">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        );
      })}

      {isLoading && (
        <div className="flex justify-start">
          <div className="rounded-lg bg-[#1f1f23] px-4 py-2">
            <div className="flex space-x-2">
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#888]" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#888]" style={{ animationDelay: '0.1s' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#888]" style={{ animationDelay: '0.2s' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
