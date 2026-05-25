/**
 * Chat Store - 对话状态管理
 * 使用 Zustand 管理状态，Dexie 持久化到 IndexedDB
 * 当 IndexedDB 不可用时（如 Zotero 9 sandbox），自动降级为内存存储
 */

import { create } from 'zustand';
import Dexie, { type EntityTable } from 'dexie';
import type { Conversation, ConversationMeta, Message } from '@/typings';
import { createLogger } from '@/utils/logger';
import { generateId } from '@/utils/id';

const logger = createLogger('chatStore');

// ========== IndexedDB 可用性检测 ==========

/** IndexedDB 是否可用（UI 可据此显示警告） */
export let isDexieAvailable = true;

// ========== Dexie 数据库定义 ==========

/**
 * ZoteroSeek 对话数据库
 * 存储完整的对话数据（包含消息历史）
 */
class ChatDatabase extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>;

  constructor() {
    super('ZoteroSeekChat');
    this.version(1).stores({
      conversations: 'id, title, updatedAt, createdAt',
    });
  }
}

// ========== 内存降级存储 ==========

/** 当 IndexedDB 不可用时，使用内存 Map 存储对话数据 */
const memoryConversations = new Map<string, Conversation>();

/**
 * 创建内存对话表，模拟 Dexie EntityTable 的关键方法
 * 仅供内部使用，当 IndexedDB 不可用时作为降级方案
 */
function createMemoryConversationsTable() {
  const getSorted = () =>
    Array.from(memoryConversations.values()).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );

  return {
    add(item: Conversation) {
      memoryConversations.set(item.id, JSON.parse(JSON.stringify(item)));
      return Promise.resolve(item.id);
    },
    delete(id: string) {
      memoryConversations.delete(id);
      return Promise.resolve();
    },
    update(id: string, changes: Partial<Conversation>) {
      const existing = memoryConversations.get(id);
      if (existing) {
        memoryConversations.set(id, { ...existing, ...changes } as Conversation);
      }
      return Promise.resolve();
    },
    get(id: string) {
      return Promise.resolve(memoryConversations.get(id));
    },
    orderBy(_field: string) {
      return {
        reverse: () => ({
          first: () => Promise.resolve(getSorted()[0]),
          toArray: () => Promise.resolve(getSorted()),
        }),
      };
    },
  };
}

// ========== 数据库初始化 ==========

let db: ChatDatabase;

if (typeof indexedDB === 'undefined') {
  // Zotero 9 sandbox: IndexedDB not available in privileged context
  isDexieAvailable = false;
  logger.warn(
    '[ZoteroSeek] IndexedDB not available, using in-memory storage',
  );

  db = { conversations: createMemoryConversationsTable() } as any;
} else {
  try {
    db = new ChatDatabase();
  } catch (error) {
    isDexieAvailable = false;
    logger.warn(
      '[ZoteroSeek] IndexedDB not available, using in-memory storage',
      error,
    );

    // 构建内存降级对象，模拟 ChatDatabase 的结构
    db = { conversations: createMemoryConversationsTable() } as any;
  }
}

/** 导出数据库实例，供跨窗口 hook 直接访问 */
export { db as chatDb };

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
      await db.conversations.add(conversation);
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
      await db.conversations.delete(id);
      logger.info('删除对话', { id });

      const { currentConversationId } = get();

      // 如果删除的是当前对话，切换到最近的对话
      if (currentConversationId === id) {
        const remaining = await db.conversations
          .orderBy('updatedAt')
          .reverse()
          .first();

        if (remaining) {
          set({
            currentConversationId: remaining.id,
            messages: remaining.messages,
          });
        } else {
          set({
            currentConversationId: null,
            messages: [],
          });
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
      await db.conversations.update(id, {
        title,
        updatedAt: new Date(),
      });
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
      const conversations = await db.conversations
        .orderBy('updatedAt')
        .reverse()
        .toArray();

      // 转换为 ConversationMeta（不含 messages）
      const metas: ConversationMeta[] = conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));

      set({ conversations: metas });
    } catch (error) {
      logger.error('获取对话列表失败', error);
      throw error;
    }
  },

  /**
   * 切换当前对话
   * 从 IndexedDB 加载完整对话数据
   */
  setCurrentConversation: async (id: string) => {
    try {
      set({ isLoading: true });

      const conversation = await db.conversations.get(id);
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
      // 获取当前对话
      const conversation = await db.conversations.get(conversationId!);
      if (!conversation) {
        logger.error('对话不存在', { id: conversationId });
        return;
      }

      // 更新对话：添加消息 + 更新时间
      const updatedMessages = [...conversation.messages, message];
      await db.conversations.update(conversationId!, {
        messages: updatedMessages,
        updatedAt: new Date(),
      });

      // 更新状态
      set({ messages: updatedMessages });

      // 如果是第一条用户消息，用它生成对话标题
      if (role === 'user' && conversation.messages.length === 0) {
        const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
        await db.conversations.update(conversationId!, { title });
        await get().listConversations();
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
      await db.conversations.update(currentConversationId, {
        messages: [],
        updatedAt: new Date(),
      });

      set({ messages: [] });
      logger.info('清空消息', { conversationId: currentConversationId });
    } catch (error) {
      logger.error('清空消息失败', error);
      throw error;
    }
  },

  /**
   * 设置 PDF 窗口的对话 ID
   * 用于跨窗口状态同步：PDF 窗口和主窗口共享同一个 Dexie 数据库
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
