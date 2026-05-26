/**
 * Message list component for ZoteroSeek
 * 支持错误消息特殊样式和空状态占位符
 */

import React from 'react';
import { Message } from '../../typings';
import { Icon } from '../common/Icon';

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

export function MessageList({ messages, isLoading }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <div className="text-center">
          <Icon name="chat" className="mx-auto mb-4 h-12 w-12" />
          <p className="text-sm">Start a conversation with ZoteroSeek</p>
          <p className="mt-1 text-xs">Ask questions about your research</p>
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
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                isErrorMessage
                  ? 'border border-red-200 bg-red-50 text-red-700'
                  : message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-800'
              }`}
            >
              {/* 错误消息显示图标 */}
              {isErrorMessage && (
                <Icon name="error" className="mb-1 inline-block h-4 w-4 text-red-500" />
              )}
              <p className="whitespace-pre-wrap text-sm">{message.content}</p>
              <p className="mt-1 text-xs opacity-70">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        );
      })}

      {isLoading && (
        <div className="flex justify-start">
          <div className="rounded-lg bg-gray-100 px-4 py-2">
            <div className="flex space-x-2">
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.1s' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.2s' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
