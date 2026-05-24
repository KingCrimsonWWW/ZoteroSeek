/**
 * useCrossWindowChat - PDF 窗口专用的对话 hook
 *
 * 设计说明：
 * - Dexie/IndexedDB 在同一 origin 的不同窗口间共享，无需特殊同步
 * - 主窗口使用 currentConversationId，PDF 窗口使用 pdfConversationId
 * - 两个窗口通过同一个 Dexie 数据库（ZoteroSeekChat）读写对话数据
 * - 本 hook 直接操作 Dexie，避免与主窗口的 currentConversationId 冲突
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useChatStore, chatDb } from '@/stores/chatStore';
import { useModelStore } from '@/stores/modelStore';
import type { ChatMessage, Message } from '@/typings';
import { createLogger } from '@/utils/logger';
import { generateId } from '@/utils/id';
import { createAdapter } from '@/utils/adapter';

const logger = createLogger('useCrossWindowChat');

/** 发送消息防抖间隔（毫秒） */
const SEND_DEBOUNCE_MS = 500;

interface UseCrossWindowChatReturn {
  messages: Message[];
  isLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  pdfConversationId: string | null;
  setPdfConversationId: (id: string | null) => void;
}

export function useCrossWindowChat(): UseCrossWindowChatReturn {
  // Store state — 只订阅 pdfConversationId，不碰 currentConversationId
  const pdfConversationId = useChatStore((s) => s.pdfConversationId);
  const setPdfConversationId = useChatStore((s) => s.setPdfConversationId);
  const listConversations = useChatStore((s) => s.listConversations);

  // Model store
  const currentConfig = useModelStore((s) => s.currentConfig);

  // Local state for PDF conversation messages
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const prevConversationIdRef = useRef(pdfConversationId);
  const lastSendTimeRef = useRef(0);

  // Display messages: local messages + streaming message
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

  // Load messages when pdfConversationId changes
  useEffect(() => {
    if (pdfConversationId) {
      chatDb.conversations.get(pdfConversationId).then((conversation) => {
        if (conversation) {
          setMessages(conversation.messages);
          logger.info('PDF 窗口加载对话', {
            id: pdfConversationId,
            messageCount: conversation.messages.length,
          });
        } else {
          setMessages([]);
          logger.warn('PDF 对话不存在', { id: pdfConversationId });
        }
      });
    } else {
      setMessages([]);
    }
  }, [pdfConversationId]);

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
    if (prevConversationIdRef.current !== pdfConversationId) {
      stopGeneration();
      prevConversationIdRef.current = pdfConversationId;
    }
  }, [pdfConversationId, stopGeneration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Create a new PDF conversation in Dexie
  const ensureConversation = useCallback(async (): Promise<string> => {
    if (pdfConversationId) {
      const existing = await chatDb.conversations.get(pdfConversationId);
      if (existing) return pdfConversationId;
    }

    // Create new conversation
    const now = new Date();
    const id = generateId();
    await chatDb.conversations.add({
      id,
      title: 'PDF 对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
    setPdfConversationId(id);
    await listConversations();
    logger.info('创建 PDF 对话', { id });
    return id;
  }, [pdfConversationId, setPdfConversationId, listConversations]);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      // Debounce
      const now = Date.now();
      if (now - lastSendTimeRef.current < SEND_DEBOUNCE_MS) {
        logger.debug('发送过于频繁，已忽略');
        return;
      }
      lastSendTimeRef.current = now;

      // Validate config
      if (!currentConfig.apiKey?.trim()) {
        logger.warn('API Key 未配置');
        const errorMsg: Message = {
          id: generateId(),
          role: 'assistant',
          content: '❌ 请先在设置中配置 API Key',
          timestamp: new Date(),
          metadata: { isError: true },
        };
        setMessages((prev) => [...prev, errorMsg]);
        return;
      }

      // Cancel any existing stream
      stopGeneration();

      // Ensure conversation exists
      const conversationId = await ensureConversation();

      // Add user message to local state
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: new Date(),
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      // Persist user message to Dexie
      await chatDb.conversations.update(conversationId, {
        messages: updatedMessages,
        updatedAt: new Date(),
      });

      // Update title from first user message
      if (messages.length === 0) {
        const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
        await chatDb.conversations.update(conversationId, { title });
        await listConversations();
      }

      // Create abort controller
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setStreamingContent('');

      try {
        const adapter = createAdapter(currentConfig);

        // Build chat messages for LLM
        const chatMessages: ChatMessage[] = updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        let fullContent = '';

        for await (const token of adapter.chat(chatMessages)) {
          if (controller.signal.aborted) break;
          fullContent += token;
          setStreamingContent(fullContent);
        }

        // Persist the complete assistant message
        if (fullContent) {
          const assistantMessage: Message = {
            id: generateId(),
            role: 'assistant',
            content: fullContent,
            timestamp: new Date(),
          };
          const finalMessages = [...updatedMessages, assistantMessage];
          setMessages(finalMessages);

          await chatDb.conversations.update(conversationId, {
            messages: finalMessages,
            updatedAt: new Date(),
          });
        }
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          const errorMsg: Message = {
            id: generateId(),
            role: 'assistant',
            content: navigator.onLine
              ? `❌ ${error.message}`
              : '❌ 网络连接已断开，请检查网络后重试',
            timestamp: new Date(),
            metadata: { isError: true },
          };
          const errorMessages = [...updatedMessages, errorMsg];
          setMessages(errorMessages);

          await chatDb.conversations.update(conversationId, {
            messages: errorMessages,
            updatedAt: new Date(),
          });
        }
      } finally {
        setIsLoading(false);
        setStreamingContent(null);
        abortControllerRef.current = null;
      }
    },
    [currentConfig, messages, stopGeneration, ensureConversation, listConversations],
  );

  return {
    messages: displayMessages,
    isLoading,
    sendMessage,
    stopGeneration,
    pdfConversationId,
    setPdfConversationId,
  };
}

export default useCrossWindowChat;
