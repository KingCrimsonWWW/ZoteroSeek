/**
 * Chat Store - 对话状态管理
 * 使用 Zustand 管理状态，通过 Worker 客户端持久化到 IndexedDB
 * 当 Worker 不可用时（如测试环境或 Zotero 9 sandbox），自动降级为内存存储
 */

import { create } from 'zustand';
import type { Conversation, ConversationMeta, Message } from '@/typings';
import { createLogger } from '@/utils/logger';
import { generateId } from '@/utils/id';
import * as dbClient from '@/db/client';
import type { ConversationDBSchema } from '@/db/db';

const logger = createLogger('chatStore');

// ========== 内存降级存储 ==========

/** 当 Worker 不可用时，使用内存 Map 存储对话数据 */
const memoryConversations = new Map<string, Conversation>();

function memoryAdd(conv: Conversation) {
  memoryConversations.set(conv.id, JSON.parse(JSON.stringify(conv)));
}

function memoryDelete(id: string) {
  memoryConversations.delete(id);
}

function memoryGet(id: string): Conversation | undefined {
  return memoryConversations.get(id);
}

function memoryUpdate(id: string, changes: Partial<Conversation>) {
  const existing = memoryConversations.get(id);
  if (existing) {
    memoryConversations.set(id, { ...existing, ...changes } as Conversation);
  }
}

function memoryListSorted(): Conversation[] {
  return Array.from(memoryConversations.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * 清空内存降级存储（测试用）
 */
export function clearMemoryStore() {
  memoryConversations.clear();
}

// ========== Worker 可用性 ==========

let workerAvailable: boolean | null = null;

async function ensureWorkerChecked(): Promise<boolean> {
  if (workerAvailable !== null) return workerAvailable;
  try {
    await dbClient.getConversations();
    workerAvailable = true;
    logger.info('DB Worker 可用');
  } catch {
    workerAvailable = false;
    logger.warn('DB Worker 不可用，使用内存降级存储');
  }
  return workerAvailable;
}

/** Worker/IndexedDB 是否可用（UI 可据此显示警告） */
export function isDexieAvailable(): boolean {
  return workerAvailable === true;
}

// ========== chatDb 兼容层 ==========
// 为 useChatBase.ts 等外部消费者提供 Dexie 风格的 API

export const chatDb = {
  conversations: {
    async get(id: string): Promise<Conversation | undefined> {
      if (await ensureWorkerChecked()) {
        const conv = await dbClient.getConversation(id);
        if (!conv) return undefined;
        const messages = await dbClient.getMessages(id);
        return { ...conv, messages } as Conversation;
      }
      return memoryGet(id);
    },

    async add(conv: Conversation): Promise<string> {
      if (await ensureWorkerChecked()) {
        const { messages, ...meta } = conv;
        await dbClient.upsertConversation(meta as ConversationDBSchema);
        if (messages?.length) {
          await dbClient.upsertMessages(
            messages.map((m) => ({ ...m, conversationId: conv.id })),
          );
        }
      } else {
        memoryAdd(conv);
      }
      return conv.id;
    },

    async update(id: string, changes: Partial<Conversation>): Promise<void> {
      if (await ensureWorkerChecked()) {
        const existing = await dbClient.getConversation(id);
        if (existing) {
          const { messages, ...metaChanges } = changes;
          await dbClient.upsertConversation({
            ...existing,
            ...metaChanges,
            updatedAt: metaChanges.updatedAt ?? new Date(),
          } as ConversationDBSchema);
          if (messages) {
            await dbClient.clearMessagesForConversation(id);
            if (messages.length > 0) {
              await dbClient.upsertMessages(
                messages.map((m) => ({ ...m, conversationId: id })),
              );
            }
          }
        }
      } else {
        memoryUpdate(id, changes);
      }
    },
  },
};

// ========== 工具函数 ==========

/** 创建新的空对话 */
function createConversation(title?: string): Conversation {
  const now = new Date();
  return {
    id: generateId(),
    title: title ?? '新对话',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 将 ConversationDBSchema 转换为 ConversationMeta */
function toMeta(c: ConversationDBSchema): ConversationMeta {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ========== Store 类型定义 ==========

interface ChatState {
  /** 当前对话 ID（主窗口使用） */
  currentConversationId: string | null;
  /** PDF 窗口对话 ID（跨窗口共享） */
  pdfConversationId: string | null;
  /** 当前对话的消息列表 */
  messages: Message[];
  /** 对话列表（缓存，用于快速访问） */
  conversations: ConversationMeta[];
  /** 是否正在加载 */
  isLoading: boolean;

  // 对话 CRUD 操作
  addConversation: (title?: string) => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  listConversations: () => Promise<void>;

  // 当前对话操作
  setCurrentConversation: (id: string) => Promise<void>;

  // 消息管理
  addMessage: (role: 'user' | 'assistant', content: string, metadata?: Record<string, unknown>) => Promise<void>;
  clearMessages: () => Promise<void>;

  // PDF 窗口操作
  setPdfConversationId: (id: string | null) => void;
}

// ========== Zustand Store ==========

export const useChatStore = create<ChatState>((set, get) => ({
  // 初始状态
  currentConversationId: null,
  pdfConversationId: null,
  messages: [],
  conversations: [],
  isLoading: false,

  /**
   * 创建新对话
   * @param title - 可选的对话标题
   * @returns 新对话的 ID
   */
  addConversation: async (title?: string) => {
    const conversation = createConversation(title);

    try {
      if (await ensureWorkerChecked()) {
        await dbClient.upsertConversation({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        });
      } else {
        memoryAdd(conversation);
      }

      logger.info('创建对话', { id: conversation.id, title: conversation.title });

      // 更新状态
      set({
        currentConversationId: conversation.id,
        messages: [],
      });

      // 刷新对话列表
      await get().listConversations();

      return conversation.id;
    } catch (error) {
      logger.error('创建对话失败', error);
      throw error;
    }
  },

  /**
   * 删除对话
   * 如果删除的是当前对话，自动切换到最近的对话
   */
  deleteConversation: async (id: string) => {
    try {
      if (await ensureWorkerChecked()) {
        await dbClient.deleteConversation(id);
      } else {
        memoryDelete(id);
      }

      logger.info('删除对话', { id });

      const { currentConversationId } = get();

      // 如果删除的是当前对话，切换到最近的对话
      if (currentConversationId === id) {
        if (await ensureWorkerChecked()) {
          const convs = await dbClient.getConversations();
          if (convs.length > 0) {
            const top = convs[0];
            const messages = await dbClient.getMessages(top.id);
            set({ currentConversationId: top.id, messages });
          } else {
            set({ currentConversationId: null, messages: [] });
          }
        } else {
          const sorted = memoryListSorted();
          if (sorted.length > 0) {
            set({
              currentConversationId: sorted[0].id,
              messages: sorted[0].messages,
            });
          } else {
            set({ currentConversationId: null, messages: [] });
          }
        }
      }

      // 刷新对话列表
      await get().listConversations();
    } catch (error) {
      logger.error('删除对话失败', error);
      throw error;
    }
  },

  /**
   * 重命名对话
   */
  renameConversation: async (id: string, title: string) => {
    try {
      const updatedAt = new Date();
      if (await ensureWorkerChecked()) {
        const conv = await dbClient.getConversation(id);
        if (conv) {
          await dbClient.upsertConversation({ ...conv, title, updatedAt });
        }
      } else {
        memoryUpdate(id, { title, updatedAt });
      }

      logger.info('重命名对话', { id, title });

      // 刷新对话列表
      await get().listConversations();
    } catch (error) {
      logger.error('重命名对话失败', error);
      throw error;
    }
  },

  /**
   * 获取对话列表（仅元数据，不含消息）
   * 用于侧边栏显示
   */
  listConversations: async () => {
    try {
      let metas: ConversationMeta[];

      if (await ensureWorkerChecked()) {
        const convs = await dbClient.getConversations();
        metas = convs.map(toMeta);
      } else {
        metas = memoryListSorted().map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));
      }

      set({ conversations: metas });
    } catch (error) {
      logger.error('获取对话列表失败', error);
      throw error;
    }
  },

  /**
   * 切换当前对话
   * 从持久化层加载完整对话数据
   */
  setCurrentConversation: async (id: string) => {
    try {
      set({ isLoading: true });

      let conversation: Conversation | undefined;

      if (await ensureWorkerChecked()) {
        const conv = await dbClient.getConversation(id);
        if (conv) {
          const messages = await dbClient.getMessages(id);
          conversation = { ...conv, messages } as Conversation;
        }
      } else {
        conversation = memoryGet(id);
      }

      if (!conversation) {
        logger.warn('对话不存在', { id });
        set({ isLoading: false });
        return;
      }

      set({
        currentConversationId: id,
        messages: conversation.messages,
        isLoading: false,
      });

      logger.info('切换对话', { id, messageCount: conversation.messages.length });
    } catch (error) {
      logger.error('切换对话失败', error);
      set({ isLoading: false });
      throw error;
    }
  },

  /**
   * 添加消息到当前对话
   * 如果没有当前对话，自动创建一个
   */
  addMessage: async (role: 'user' | 'assistant', content: string, metadata?: Record<string, unknown>) => {
    // 如果没有当前对话，先创建一个
    let conversationId = get().currentConversationId;
    if (!conversationId) {
      await get().addConversation();
      // 重新读取，避免 TOCTOU 竞态（并发调用可能已创建对话）
      conversationId = get().currentConversationId;
    }

    const message: Message = {
      id: generateId(),
      role,
      content,
      timestamp: new Date(),
      metadata,
    };

    try {
      if (await ensureWorkerChecked()) {
        // 检查已有消息数量（用于判断是否为第一条消息）
        const existingMessages = await dbClient.getMessages(conversationId!);

        // 保存消息到 messages 表
        await dbClient.upsertMessage({
          ...message,
          conversationId: conversationId!,
        });

        // 更新对话元数据
        const conv = await dbClient.getConversation(conversationId!);
        if (conv) {
          const updates: Partial<ConversationDBSchema> = { updatedAt: new Date() };
          // 如果是第一条用户消息，用它生成对话标题
          if (role === 'user' && existingMessages.length === 0) {
            updates.title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
          }
          await dbClient.upsertConversation({
            ...conv,
            ...updates,
          } as ConversationDBSchema);
        }

        // 重新加载消息列表
        const allMessages = await dbClient.getMessages(conversationId!);
        set({ messages: allMessages });

        // 如果标题更新了，刷新对话列表
        if (role === 'user' && existingMessages.length === 0) {
          await get().listConversations();
        }
      } else {
        // 内存降级路径
        const conversation = memoryGet(conversationId!);
        if (!conversation) {
          logger.error('对话不存在', { id: conversationId });
          return;
        }

        // 更新对话：添加消息 + 更新时间
        const updatedMessages = [...conversation.messages, message];
        memoryUpdate(conversationId!, {
          messages: updatedMessages,
          updatedAt: new Date(),
        });

        // 更新状态
        set({ messages: updatedMessages });

        // 如果是第一条用户消息，用它生成对话标题
        if (role === 'user' && conversation.messages.length === 0) {
          const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
          memoryUpdate(conversationId!, { title });
          await get().listConversations();
        }
      }

      logger.debug('添加消息', { conversationId, role, messageLength: content.length });
    } catch (error) {
      logger.error('添加消息失败', error);
      throw error;
    }
  },

  /**
   * 清空当前对话的消息
   */
  clearMessages: async () => {
    const { currentConversationId } = get();
    if (!currentConversationId) {
      return;
    }

    try {
      if (await ensureWorkerChecked()) {
        await dbClient.clearMessagesForConversation(currentConversationId);
        // 更新对话时间戳
        const conv = await dbClient.getConversation(currentConversationId);
        if (conv) {
          await dbClient.upsertConversation({ ...conv, updatedAt: new Date() });
        }
      } else {
        memoryUpdate(currentConversationId, {
          messages: [],
          updatedAt: new Date(),
        });
      }

      set({ messages: [] });
      logger.info('清空消息', { conversationId: currentConversationId });
    } catch (error) {
      logger.error('清空消息失败', error);
      throw error;
    }
  },

  /**
   * 设置 PDF 窗口的对话 ID
   * 用于跨窗口状态同步
   */
  setPdfConversationId: (id: string | null) => {
    set({ pdfConversationId: id });
    logger.info('设置 PDF 对话 ID', { id });
  },
}));

/**
 * 初始化对话列表
 * 在应用启动时调用，加载对话列表到内存
 */
export async function initChatStore(): Promise<void> {
  try {
    await useChatStore.getState().listConversations();
    logger.info('对话列表初始化完成');
  } catch (error) {
    logger.error('对话列表初始化失败', error);
  }
}

export default useChatStore;
