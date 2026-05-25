/**
 * Chat Store 单元测试
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock db client (Worker 不可用，测试走内存降级路径)
vi.mock('@/db/client', () => ({
  getConversations: vi.fn().mockRejectedValue(new Error('Worker not available')),
  getConversation: vi.fn().mockRejectedValue(new Error('Worker not available')),
  upsertConversation: vi.fn().mockRejectedValue(new Error('Worker not available')),
  deleteConversation: vi.fn().mockRejectedValue(new Error('Worker not available')),
  upsertMessage: vi.fn().mockRejectedValue(new Error('Worker not available')),
  getMessages: vi.fn().mockRejectedValue(new Error('Worker not available')),
  clearMessagesForConversation: vi.fn().mockRejectedValue(new Error('Worker not available')),
}));

import { useChatStore, clearMemoryStore } from '@/stores/chatStore';

describe('chatStore', () => {
  beforeEach(async () => {
    // 清空内存降级存储（Worker 不可用时使用内存 Map）
    clearMemoryStore();

    // 重置 store 状态
    useChatStore.setState({
      currentConversationId: null,
      messages: [],
      conversations: [],
      isLoading: false,
    });
  });

  describe('addConversation', () => {
    it('应创建新对话并返回 ID', async () => {
      const id = await useChatStore.getState().addConversation('测试对话');

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');

      const state = useChatStore.getState();
      expect(state.currentConversationId).toBe(id);
      expect(state.messages).toEqual([]);
    });

    it('应使用默认标题（未指定时）', async () => {
      const id = await useChatStore.getState().addConversation();
      expect(id).toBeTruthy();
    });

    it('应更新对话列表', async () => {
      await useChatStore.getState().addConversation('对话1');
      await useChatStore.getState().addConversation('对话2');

      const state = useChatStore.getState();
      expect(state.conversations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('deleteConversation', () => {
    it('应删除指定对话', async () => {
      const id = await useChatStore.getState().addConversation('待删除');
      await useChatStore.getState().deleteConversation(id);

      const state = useChatStore.getState();
      expect(state.conversations.find((c) => c.id === id)).toBeUndefined();
    });

    it('删除当前对话后应切换到最近的对话', async () => {
      const id1 = await useChatStore.getState().addConversation('对话1');
      // 小延迟确保时间戳不同
      await new Promise((r) => setTimeout(r, 10));
      const id2 = await useChatStore.getState().addConversation('对话2');

      // id2 是当前对话，删除它
      await useChatStore.getState().deleteConversation(id2);

      const state = useChatStore.getState();
      expect(state.currentConversationId).toBe(id1);
    });

    it('删除唯一对话后应清空状态', async () => {
      const id = await useChatStore.getState().addConversation('唯一对话');
      await useChatStore.getState().deleteConversation(id);

      const state = useChatStore.getState();
      expect(state.currentConversationId).toBeNull();
      expect(state.messages).toEqual([]);
    });
  });

  describe('renameConversation', () => {
    it('应重命名对话', async () => {
      const id = await useChatStore.getState().addConversation('原名');
      await useChatStore.getState().renameConversation(id, '新名');

      const state = useChatStore.getState();
      const conv = state.conversations.find((c) => c.id === id);
      expect(conv?.title).toBe('新名');
    });
  });

  describe('listConversations', () => {
    it('应加载对话列表', async () => {
      await useChatStore.getState().addConversation('对话A');
      await useChatStore.getState().addConversation('对话B');

      // 手动调用 listConversations 刷新
      await useChatStore.getState().listConversations();

      const state = useChatStore.getState();
      expect(state.conversations.length).toBeGreaterThanOrEqual(2);
    });

    it('对话列表应按 updatedAt 降序排列', async () => {
      const id1 = await useChatStore.getState().addConversation('旧对话');
      await new Promise((r) => setTimeout(r, 10));
      const id2 = await useChatStore.getState().addConversation('新对话');

      const state = useChatStore.getState();
      const idx1 = state.conversations.findIndex((c) => c.id === id1);
      const idx2 = state.conversations.findIndex((c) => c.id === id2);

      // 新对话应在前面（index 更小）
      expect(idx2).toBeLessThan(idx1);
    });
  });

  describe('setCurrentConversation', () => {
    it('应切换到指定对话并加载消息', async () => {
      const id = await useChatStore.getState().addConversation('目标对话');

      // 添加一条消息
      await useChatStore.getState().addMessage('user', '你好');

      // 创建另一个对话
      await useChatStore.getState().addConversation('其他对话');

      // 切换回第一个对话
      await useChatStore.getState().setCurrentConversation(id);

      const state = useChatStore.getState();
      expect(state.currentConversationId).toBe(id);
      expect(state.messages.length).toBe(1);
      expect(state.messages[0].content).toBe('你好');
    });

    it('切换不存在的对话应保持当前状态', async () => {
      const initialState = useChatStore.getState();
      const initialId = initialState.currentConversationId;

      await useChatStore.getState().setCurrentConversation('non-existent-id');

      // 不应改变当前对话
      expect(useChatStore.getState().currentConversationId).toBe(initialId);
    });
  });

  describe('addMessage', () => {
    it('应添加消息到当前对话', async () => {
      await useChatStore.getState().addConversation('测试');
      await useChatStore.getState().addMessage('user', 'Hello');

      const state = useChatStore.getState();
      expect(state.messages.length).toBe(1);
      expect(state.messages[0].role).toBe('user');
      expect(state.messages[0].content).toBe('Hello');
    });

    it('无当前对话时应自动创建', async () => {
      expect(useChatStore.getState().currentConversationId).toBeNull();

      await useChatStore.getState().addMessage('user', '自动创建');

      const state = useChatStore.getState();
      expect(state.currentConversationId).toBeTruthy();
      expect(state.messages.length).toBe(1);
    });

    it('第一条用户消息应成为对话标题', async () => {
      await useChatStore.getState().addConversation('默认标题');
      await useChatStore.getState().addMessage('user', '这是一条很长的用户消息用来测试标题截断功能');

      const state = useChatStore.getState();
      const currentId = state.currentConversationId;
      const conv = state.conversations.find((c) => c.id === currentId);

      // 标题应被截断到 50 字符
      expect(conv?.title).toBe('这是一条很长的用户消息用来测试标题截断功能');
      expect(conv?.title.length).toBeLessThanOrEqual(50);
    });

    it('超长消息标题应被截断', async () => {
      await useChatStore.getState().addConversation();
      const longMessage = 'a'.repeat(60);
      await useChatStore.getState().addMessage('user', longMessage);

      const state = useChatStore.getState();
      const currentId = state.currentConversationId;
      const conv = state.conversations.find((c) => c.id === currentId);

      expect(conv?.title).toBe('a'.repeat(50) + '...');
    });

    it('应支持 metadata 参数', async () => {
      await useChatStore.getState().addConversation();
      await useChatStore.getState().addMessage('assistant', '回复', { model: 'gpt-4' });

      const state = useChatStore.getState();
      expect(state.messages[0].metadata).toEqual({ model: 'gpt-4' });
    });
  });

  describe('clearMessages', () => {
    it('应清空当前对话的消息', async () => {
      await useChatStore.getState().addConversation();
      await useChatStore.getState().addMessage('user', 'msg1');
      await useChatStore.getState().addMessage('assistant', 'msg2');

      expect(useChatStore.getState().messages.length).toBe(2);

      await useChatStore.getState().clearMessages();

      expect(useChatStore.getState().messages).toEqual([]);
    });

    it('无当前对话时应静默返回', async () => {
      expect(useChatStore.getState().currentConversationId).toBeNull();

      // 不应抛出错误
      await useChatStore.getState().clearMessages();

      expect(useChatStore.getState().messages).toEqual([]);
    });
  });
});
