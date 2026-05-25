/**
 * useChat - 薄封装层，委托 useChatBase 处理核心逻辑
 *
 * 职责：
 * - 连接 chatStore（消息持久化、对话 ID）
 * - 连接 modelStore（LLM 配置）
 * - 创建 adapter 并注入 useChatBase
 * - 构建 displayMessages（store 消息 + 流式消息）
 * - 实现 clearMessages
 */

import { useMemo, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useModelStore } from '@/stores/modelStore';
import type { Message } from '@/typings';
import { createAdapter } from '@/utils/adapter';
import { useChatBase } from '@/hooks/useChatBase';

interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => Promise<void>;
}

export function useChat(): UseChatReturn {
  // ── Store selectors ──
  const storeMessages = useChatStore((s) => s.messages);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const addMessage = useChatStore((s) => s.addMessage);
  const clearChatMessages = useChatStore((s) => s.clearMessages);
  const currentConfig = useModelStore((s) => s.currentConfig);

  // ── Derived config ──
  const adapter = useMemo(() => createAdapter(currentConfig), [currentConfig]);

  const ragConfig = useMemo(
    () => ({
      apiKey: currentConfig.apiKey,
      baseUrl: currentConfig.baseUrl,
      model: currentConfig.model,
    }),
    [currentConfig.apiKey, currentConfig.baseUrl, currentConfig.model],
  );

  // ── 委托核心逻辑 ──
  const { sendMessage, stopGeneration, isLoading, streamingContent } =
    useChatBase({
      messages: storeMessages,
      onAddMessage: addMessage,
      adapter,
      apiKey: currentConfig.apiKey,
      conversationId: currentConversationId,
      ragConfig,
    });

  // ── Display messages: store + 流式消息 ──
  const displayMessages = useMemo(() => {
    if (streamingContent !== null) {
      const streamingMessage: Message = {
        id: 'streaming',
        role: 'assistant',
        content: streamingContent,
        timestamp: new Date(),
      };
      return [...storeMessages, streamingMessage];
    }
    return storeMessages;
  }, [storeMessages, streamingContent]);

  // ── Clear messages ──
  const clearMessages = useCallback(async () => {
    stopGeneration();
    await clearChatMessages();
  }, [clearChatMessages, stopGeneration]);

  return {
    messages: displayMessages,
    isLoading,
    sendMessage,
    stopGeneration,
    clearMessages,
  };
}
