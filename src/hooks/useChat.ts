/**
 * useChat hook for managing chat state and LLM communication
 * Integrates with chatStore for persistence and modelStore for LLM config
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useModelStore } from '@/stores/modelStore';
import type { ChatMessage, Message } from '@/typings';
import { createLogger } from '@/utils/logger';
import { createAdapter } from '@/utils/adapter';
import { augmentMessage } from '@/services/rag/chatIntegration';

const logger = createLogger('useChat');

/** 发送消息防抖间隔（毫秒） */
const SEND_DEBOUNCE_MS = 500;

interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => Promise<void>;
}

export function useChat(): UseChatReturn {
  // Chat store
  const messages = useChatStore((s) => s.messages);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const addMessage = useChatStore((s) => s.addMessage);
  const clearChatMessages = useChatStore((s) => s.clearMessages);

  // Model store
  const currentConfig = useModelStore((s) => s.currentConfig);

  // Local streaming state
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const prevConversationIdRef = useRef(currentConversationId);
  const lastSendTimeRef = useRef(0);

  // Display messages: chatStore messages + streaming message
  const displayMessages = useMemo(() => {
    if (streamingContent !== null) {
      const streamingMessage: Message = {
        id: 'streaming',
        role: 'assistant',
        content: streamingContent,
        timestamp: new Date(),
      };
      return [...messages, streamingMessage];
    }
    return messages;
  }, [messages, streamingContent]);

  // Cancel active stream
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setStreamingContent(null);
  }, []);

  // Cancel stream when conversation changes
  useEffect(() => {
    if (prevConversationIdRef.current !== currentConversationId) {
      stopGeneration();
      prevConversationIdRef.current = currentConversationId;
    }
  }, [currentConversationId, stopGeneration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      // 防抖：阻止快速连续发送
      const now = Date.now();
      if (now - lastSendTimeRef.current < SEND_DEBOUNCE_MS) {
        logger.debug('发送过于频繁，已忽略');
        return;
      }
      lastSendTimeRef.current = now;

      // Validate config
      if (!currentConfig.apiKey?.trim()) {
        logger.warn('API Key 未配置');
        await addMessage('assistant', '❌ 请先在设置中配置 API Key', {
          isError: true,
        });
        return;
      }

      // Cancel any existing stream (确保一次只有一个活跃流)
      stopGeneration();

      // Add user message to store (persists to IndexedDB)
      await addMessage('user', content);

      // Update ref to prevent conversation change effect from cancelling this stream
      prevConversationIdRef.current =
        useChatStore.getState().currentConversationId;

      // Create abort controller
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setStreamingContent('');

      try {
        const adapter = createAdapter(currentConfig);

        // Build chat messages from store (includes the user message we just added)
        const storeMessages = useChatStore.getState().messages;
        const chatMessages: ChatMessage[] = storeMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // RAG: 检索相关文献并注入上下文
        try {
          const { context } = await augmentMessage(
            content,
            currentConfig.apiKey,
            3,
            currentConfig.baseUrl,
            currentConfig.model,
          );
          if (context) {
            chatMessages.unshift({
              role: 'system',
              content: `基于以下文献内容回答用户问题：\n\n${context}`,
            });
          }
        } catch (ragError) {
          logger.warn('RAG 增强失败，使用普通对话', (ragError as Error).message);
        }

        let fullContent = '';

        for await (const token of adapter.chat(chatMessages)) {
          if (controller.signal.aborted) break;
          fullContent += token;
          setStreamingContent(fullContent);
        }

        // Persist the complete assistant message
        if (fullContent) {
          await addMessage('assistant', fullContent);
        }
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          // 网络错误检测
          if (!navigator.onLine) {
            logger.error('网络连接已断开');
            await addMessage('assistant', '❌ 网络连接已断开，请检查网络后重试', {
              isError: true,
            });
          } else {
            logger.error('对话请求失败:', error.message);
            await addMessage('assistant', `❌ ${error.message}`, {
              isError: true,
            });
          }
        }
      } finally {
        setIsLoading(false);
        setStreamingContent(null);
        abortControllerRef.current = null;
      }
    },
    [currentConfig, addMessage, stopGeneration],
  );

  // Clear messages
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
