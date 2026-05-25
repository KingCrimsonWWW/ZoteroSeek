/**
 * useChatBase - 共享聊天逻辑 hook
 *
 * 从 useChat 和 useCrossWindowChat 提取的公共逻辑：
 * - AbortController 管理（中断控制）
 * - SSE 流式响应处理（token-by-token 更新）
 * - 错误处理（AbortError、网络错误、API 错误）
 * - RAG 增强（chatIntegration 调用）
 * - 消息发送防抖
 * - 对话切换时取消活跃流
 *
 * 调用者通过参数注入自己的 store 逻辑，实现解耦。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, LLMAdapter, Message } from '@/typings';
import { createLogger } from '@/utils/logger';
import { augmentMessage } from '@/services/rag/chatIntegration';

const logger = createLogger('useChatBase');

/** 发送消息防抖间隔（毫秒） */
const SEND_DEBOUNCE_MS = 500;

/**
 * RAG 配置
 */
export interface RagConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/**
 * useChatBase 选项
 */
export interface UseChatBaseOptions {
  /** 当前消息列表（来自 store 或本地状态） */
  messages: Message[];
  /** 添加消息的回调（调用者处理持久化） */
  onAddMessage: (
    role: 'user' | 'assistant',
    content: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  /** LLM 适配器 */
  adapter: LLMAdapter | null;
  /** API Key（用于验证） */
  apiKey?: string;
  /** 当前对话 ID（用于变化检测） */
  conversationId: string | null;
  /** RAG 配置（可选，启用 RAG 增强） */
  ragConfig?: RagConfig;
}

/**
 * useChatBase 返回值
 */
export interface UseChatBaseReturn {
  /** 发送消息 */
  sendMessage: (content: string) => Promise<void>;
  /** 停止生成 */
  stopGeneration: () => void;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否正在流式传输 */
  isStreaming: boolean;
  /** 错误信息 */
  error: string | null;
}

/**
 * 共享聊天逻辑 hook
 *
 * @param options - 配置选项
 * @returns sendMessage, stopGeneration, isLoading, isStreaming, error
 */
export function useChatBase(options: UseChatBaseOptions): UseChatBaseReturn {
  const {
    messages,
    onAddMessage,
    adapter,
    apiKey,
    conversationId,
    ragConfig,
  } = options;

  // Local streaming state
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const prevConversationIdRef = useRef(conversationId);
  const lastSendTimeRef = useRef(0);

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
    if (prevConversationIdRef.current !== conversationId) {
      stopGeneration();
      prevConversationIdRef.current = conversationId;
    }
  }, [conversationId, stopGeneration]);

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

      // Validate adapter
      if (!adapter) {
        logger.warn('LLM 适配器未配置');
        await onAddMessage('assistant', '❌ LLM 适配器未配置，请检查设置', {
          isError: true,
        });
        return;
      }

      // Validate API key
      if (!apiKey?.trim()) {
        logger.warn('API Key 未配置');
        await onAddMessage('assistant', '❌ 请先在设置中配置 API Key', {
          isError: true,
        });
        return;
      }

      // Cancel any existing stream (确保一次只有一个活跃流)
      stopGeneration();
      setError(null);

      // Add user message
      await onAddMessage('user', content);

      // Update ref to prevent conversation change effect from cancelling this stream
      prevConversationIdRef.current = conversationId;

      // Create abort controller
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setStreamingContent('');

      try {
        // Build chat messages from caller-provided messages
        const chatMessages: ChatMessage[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // RAG: 检索相关文献并注入上下文
        if (ragConfig) {
          try {
            const { context } = await augmentMessage(
              content,
              ragConfig.apiKey,
              3,
              ragConfig.baseUrl,
              ragConfig.model,
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
        }

        let fullContent = '';

        for await (const token of adapter.chat(chatMessages)) {
          if (controller.signal.aborted) break;
          fullContent += token;
          setStreamingContent(fullContent);
        }

        // Persist the complete assistant message
        if (fullContent) {
          await onAddMessage('assistant', fullContent);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          // 网络错误检测
          if (!navigator.onLine) {
            logger.error('网络连接已断开');
            const networkError = '❌ 网络连接已断开，请检查网络后重试';
            setError(networkError);
            await onAddMessage('assistant', networkError, { isError: true });
          } else {
            logger.error('对话请求失败:', err.message);
            const errorMsg = `❌ ${err.message}`;
            setError(errorMsg);
            await onAddMessage('assistant', errorMsg, { isError: true });
          }
        }
      } finally {
        setIsLoading(false);
        setStreamingContent(null);
        abortControllerRef.current = null;
      }
    },
    [messages, onAddMessage, adapter, apiKey, conversationId, ragConfig, stopGeneration],
  );

  return {
    sendMessage,
    stopGeneration,
    isLoading,
    isStreaming: streamingContent !== null,
    error,
  };
}
