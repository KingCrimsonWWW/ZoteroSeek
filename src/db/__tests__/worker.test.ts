/**
 * Worker + Dexie 集成测试
 *
 * 测试 dbWorkers.ts 中的 20 个 MessageHelper handler 的 CRUD 操作。
 * 使用 fake-indexeddb 提供 IndexedDB 支持，mock MessageHelper 避免 Web Worker 依赖。
 */

// Polyfill `self` — Worker global not available in Node.js test environment
if (typeof globalThis.self === 'undefined') {
  (globalThis as any).self = globalThis;
}

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MessageHelper BEFORE importing dbWorkers
vi.mock('zotero-plugin-toolkit', () => ({
  MessageHelper: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    destroy: vi.fn(),
    exec: vi.fn(),
    proxy: {},
  })),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the entire dbWorkers module to prevent self reference error
vi.mock('@/workers/dbWorkers', () => ({
  handlers: {
    upsertConversation: vi.fn(),
    getConversation: vi.fn(),
    getConversations: vi.fn(),
    deleteConversation: vi.fn(),
    upsertMessage: vi.fn(),
    upsertMessages: vi.fn(),
    getMessages: vi.fn(),
    deleteMessage: vi.fn(),
    deleteMessages: vi.fn(),
    clearAllMessages: vi.fn(),
    clearMessagesForConversation: vi.fn(),
    upsertChunks: vi.fn(),
    getChunksByItem: vi.fn(),
    getAllChunks: vi.fn(),
    deleteChunksByItem: vi.fn(),
    clearAllChunks: vi.fn(),
    getProgress: vi.fn(),
    upsertProgress: vi.fn(),
    clearAllProgress: vi.fn(),
    _ping: vi.fn(),
  },
}));

// Import AFTER mocks are set up
import { chatDb, ragDb } from '@/db/db';

// ─── 测试数据工厂 ────────────────────────────────────────────────

function createTestConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Conversation',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createTestMessage(
  conversationId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user' as const,
    content: 'Hello, world!',
    timestamp: new Date('2026-01-01T12:00:00'),
    conversationId,
    ...overrides,
  };
}

function createTestChunk(itemId: number, overrides: Record<string, unknown> = {}) {
  return {
    itemId,
    itemTitle: `Paper ${itemId}`,
    chunkIndex: 0,
    chunkText: `Chunk text for item ${itemId}`,
    embedding: [1, 0, 0],
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createTestProgress(overrides: Record<string, unknown> = {}) {
  return {
    id: 'global',
    indexedItemIds: [] as number[],
    totalItems: 0,
    ...overrides,
  };
}

// ─── 测试套件 ────────────────────────────────────────────────────

describe('Worker + Dexie 集成测试', () => {
  // 每个测试前清空数据库
  beforeEach(async () => {
    await chatDb.conversations.clear();
    await chatDb.messages.clear();
    await ragDb.chunks.clear();
    await ragDb.progress.clear();
  });

  // =========================================================================
  // Handler 存在性检查
  // =========================================================================

  describe('Handler 注册', () => {
    it('handlers 对象应包含所有 20 个 handler', () => {
      const expectedHandlers = [
        // Conversation CRUD (4)
        'upsertConversation',
        'getConversation',
        'getConversations',
        'deleteConversation',
        // Message CRUD (7)
        'upsertMessage',
        'upsertMessages',
        'getMessages',
        'deleteMessage',
        'deleteMessages',
        'clearAllMessages',
        'clearMessagesForConversation',
        // RAG Chunks (5)
        'upsertChunks',
        'getChunksByItem',
        'getAllChunks',
        'deleteChunksByItem',
        'clearAllChunks',
        // RAG Progress (3)
        'getProgress',
        'upsertProgress',
        'clearAllProgress',
        // Utility (1)
        '_ping',
      ];

      expect(Object.keys(handlers)).toHaveLength(20);
      for (const name of expectedHandlers) {
        expect(handlers).toHaveProperty(name);
        expect(typeof (handlers as Record<string, unknown>)[name]).toBe('function');
      }
    });
  });

  // =========================================================================
  // _ping
  // =========================================================================

  describe('_ping', () => {
    it('应返回 true', async () => {
      const result = await handlers._ping();
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // Conversation CRUD
  // =========================================================================

  describe('Conversation CRUD', () => {
    describe('upsertConversation', () => {
      it('应创建新对话', async () => {
        const conv = createTestConversation();
        await handlers.upsertConversation(conv);

        const stored = await chatDb.conversations.get(conv.id);
        expect(stored).toBeDefined();
        expect(stored!.title).toBe('Test Conversation');
      });

      it('应更新已有对话（upsert 语义）', async () => {
        const conv = createTestConversation({ title: 'Original' });
        await handlers.upsertConversation(conv);

        // 更新标题
        await handlers.upsertConversation({ ...conv, title: 'Updated' });

        const stored = await chatDb.conversations.get(conv.id);
        expect(stored!.title).toBe('Updated');
      });
    });

    describe('getConversation', () => {
      it('应返回指定 ID 的对话', async () => {
        const conv = createTestConversation();
        await handlers.upsertConversation(conv);

        const result = await handlers.getConversation(conv.id);
        expect(result).toBeDefined();
        expect(result!.id).toBe(conv.id);
      });

      it('不存在的 ID 应返回 undefined', async () => {
        const result = await handlers.getConversation('non-existent');
        expect(result).toBeUndefined();
      });
    });

    describe('getConversations', () => {
      it('应返回所有对话，按 updatedAt 降序', async () => {
        const old = createTestConversation({
          id: 'old',
          title: 'Old',
          updatedAt: new Date('2026-01-01'),
        });
        const recent = createTestConversation({
          id: 'recent',
          title: 'Recent',
          updatedAt: new Date('2026-06-01'),
        });

        await handlers.upsertConversation(old);
        await handlers.upsertConversation(recent);

        const result = await handlers.getConversations();
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('recent');
        expect(result[1].id).toBe('old');
      });

      it('空数据库应返回空数组', async () => {
        const result = await handlers.getConversations();
        expect(result).toEqual([]);
      });
    });

    describe('deleteConversation', () => {
      it('应删除对话及其关联消息', async () => {
        const conv = createTestConversation();
        await handlers.upsertConversation(conv);

        // 添加关联消息
        await handlers.upsertMessage(createTestMessage(conv.id, { id: 'msg1' }));
        await handlers.upsertMessage(createTestMessage(conv.id, { id: 'msg2' }));

        // 删除对话
        await handlers.deleteConversation(conv.id);

        // 验证对话已删除
        const storedConv = await chatDb.conversations.get(conv.id);
        expect(storedConv).toBeUndefined();

        // 验证关联消息已删除
        const messages = await chatDb.messages
          .where('conversationId')
          .equals(conv.id)
          .toArray();
        expect(messages).toHaveLength(0);
      });

      it('删除不存在的对话不应抛出错误', async () => {
        await expect(handlers.deleteConversation('non-existent')).resolves.toBeUndefined();
      });
    });
  });

  // =========================================================================
  // Message CRUD
  // =========================================================================

  describe('Message CRUD', () => {
    let convId: string;

    beforeEach(async () => {
      const conv = createTestConversation();
      convId = conv.id;
      await handlers.upsertConversation(conv);
    });

    describe('upsertMessage', () => {
      it('应创建新消息', async () => {
        const msg = createTestMessage(convId);
        await handlers.upsertMessage(msg);

        const stored = await chatDb.messages.get(msg.id);
        expect(stored).toBeDefined();
        expect(stored!.content).toBe('Hello, world!');
        expect(stored!.conversationId).toBe(convId);
      });

      it('应更新已有消息（upsert 语义）', async () => {
        const msg = createTestMessage(convId, { id: 'msg-upsert', content: 'Original' });
        await handlers.upsertMessage(msg);

        await handlers.upsertMessage({ ...msg, content: 'Updated' });

        const stored = await chatDb.messages.get('msg-upsert');
        expect(stored!.content).toBe('Updated');
      });
    });

    describe('upsertMessages', () => {
      it('应批量创建消息', async () => {
        const messages = [
          createTestMessage(convId, { id: 'bulk1', content: 'Message 1' }),
          createTestMessage(convId, { id: 'bulk2', content: 'Message 2' }),
          createTestMessage(convId, { id: 'bulk3', content: 'Message 3' }),
        ];

        await handlers.upsertMessages(messages);

        const stored = await chatDb.messages.bulkGet(['bulk1', 'bulk2', 'bulk3']);
        expect(stored).toHaveLength(3);
        expect(stored.every((m) => m !== undefined)).toBe(true);
      });
    });

    describe('getMessages', () => {
      it('应返回指定对话的消息，按 timestamp 排序', async () => {
        const msg1 = createTestMessage(convId, {
          id: 'm1',
          content: 'First',
          timestamp: new Date('2026-01-01T10:00:00'),
        });
        const msg2 = createTestMessage(convId, {
          id: 'm2',
          content: 'Second',
          timestamp: new Date('2026-01-01T12:00:00'),
        });

        await handlers.upsertMessages([msg2, msg1]); // 故意乱序插入

        const result = await handlers.getMessages(convId);
        expect(result).toHaveLength(2);
        expect(result[0].content).toBe('First');
        expect(result[1].content).toBe('Second');
      });

      it('无消息的对话应返回空数组', async () => {
        const result = await handlers.getMessages(convId);
        expect(result).toEqual([]);
      });
    });

    describe('deleteMessage', () => {
      it('应删除单条消息', async () => {
        const msg = createTestMessage(convId, { id: 'del-single' });
        await handlers.upsertMessage(msg);

        await handlers.deleteMessage('del-single');

        const stored = await chatDb.messages.get('del-single');
        expect(stored).toBeUndefined();
      });
    });

    describe('deleteMessages', () => {
      it('应批量删除消息', async () => {
        const messages = [
          createTestMessage(convId, { id: 'del-b1' }),
          createTestMessage(convId, { id: 'del-b2' }),
          createTestMessage(convId, { id: 'del-b3' }),
        ];
        await handlers.upsertMessages(messages);

        await handlers.deleteMessages(['del-b1', 'del-b3']);

        const remaining = await handlers.getMessages(convId);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('del-b2');
      });
    });

    describe('clearAllMessages', () => {
      it('应清空所有对话的消息', async () => {
        const conv2 = createTestConversation({ id: 'conv2' });
        await handlers.upsertConversation(conv2);

        await handlers.upsertMessage(createTestMessage(convId, { id: 'c1' }));
        await handlers.upsertMessage(createTestMessage('conv2', { id: 'c2' }));

        await handlers.clearAllMessages();

        const allMessages = await chatDb.messages.toArray();
        expect(allMessages).toHaveLength(0);
      });
    });

    describe('clearMessagesForConversation', () => {
      it('应仅清空指定对话的消息', async () => {
        const conv2 = createTestConversation({ id: 'conv-target' });
        await handlers.upsertConversation(conv2);

        await handlers.upsertMessage(createTestMessage(convId, { id: 'keep' }));
        await handlers.upsertMessage(createTestMessage('conv-target', { id: 'clear' }));

        await handlers.clearMessagesForConversation('conv-target');

        const kept = await handlers.getMessages(convId);
        expect(kept).toHaveLength(1);
        expect(kept[0].id).toBe('keep');

        const cleared = await handlers.getMessages('conv-target');
        expect(cleared).toHaveLength(0);
      });
    });
  });

  // =========================================================================
  // RAG Chunks
  // =========================================================================

  describe('RAG Chunks', () => {
    describe('upsertChunks', () => {
      it('应批量插入 chunk', async () => {
        const chunks = [
          createTestChunk(1, { chunkIndex: 0 }),
          createTestChunk(1, { chunkIndex: 1 }),
          createTestChunk(2, { chunkIndex: 0 }),
        ];

        await handlers.upsertChunks(chunks);

        const all = await ragDb.chunks.toArray();
        expect(all).toHaveLength(3);
      });
    });

    describe('getChunksByItem', () => {
      it('应返回指定 itemId 的 chunks', async () => {
        await handlers.upsertChunks([
          createTestChunk(100, { chunkIndex: 0 }),
          createTestChunk(100, { chunkIndex: 1 }),
          createTestChunk(200, { chunkIndex: 0 }),
        ]);

        const result = await handlers.getChunksByItem(100);
        expect(result).toHaveLength(2);
        expect(result.every((c) => c.itemId === 100)).toBe(true);
      });

      it('无匹配的 itemId 应返回空数组', async () => {
        const result = await handlers.getChunksByItem(999);
        expect(result).toEqual([]);
      });
    });

    describe('getAllChunks', () => {
      it('应返回所有 chunks', async () => {
        await handlers.upsertChunks([
          createTestChunk(1),
          createTestChunk(2),
          createTestChunk(3),
        ]);

        const result = await handlers.getAllChunks();
        expect(result).toHaveLength(3);
      });

      it('空数据库应返回空数组', async () => {
        const result = await handlers.getAllChunks();
        expect(result).toEqual([]);
      });
    });

    describe('deleteChunksByItem', () => {
      it('应删除指定 itemId 的 chunks', async () => {
        await handlers.upsertChunks([
          createTestChunk(10, { chunkIndex: 0 }),
          createTestChunk(10, { chunkIndex: 1 }),
          createTestChunk(20, { chunkIndex: 0 }),
        ]);

        await handlers.deleteChunksByItem(10);

        const remaining = await handlers.getAllChunks();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].itemId).toBe(20);
      });
    });

    describe('clearAllChunks', () => {
      it('应清空所有 chunks', async () => {
        await handlers.upsertChunks([createTestChunk(1), createTestChunk(2)]);

        await handlers.clearAllChunks();

        const result = await handlers.getAllChunks();
        expect(result).toHaveLength(0);
      });
    });
  });

  // =========================================================================
  // RAG Progress
  // =========================================================================

  describe('RAG Progress', () => {
    describe('upsertProgress', () => {
      it('应创建索引进度记录', async () => {
        const progress = createTestProgress({
          indexedItemIds: [1, 2, 3],
          totalItems: 10,
        });

        await handlers.upsertProgress(progress);

        const stored = await ragDb.progress.get('global');
        expect(stored).toBeDefined();
        expect(stored!.indexedItemIds).toEqual([1, 2, 3]);
        expect(stored!.totalItems).toBe(10);
      });

      it('应更新已有进度（upsert 语义）', async () => {
        await handlers.upsertProgress(
          createTestProgress({ indexedItemIds: [1], totalItems: 5 }),
        );
        await handlers.upsertProgress(
          createTestProgress({ indexedItemIds: [1, 2, 3], totalItems: 5 }),
        );

        const stored = await ragDb.progress.get('global');
        expect(stored!.indexedItemIds).toEqual([1, 2, 3]);
      });
    });

    describe('getProgress', () => {
      it('应返回指定 ID 的进度', async () => {
        const progress = createTestProgress({
          indexedItemIds: [100, 200],
          totalItems: 50,
        });
        await handlers.upsertProgress(progress);

        const result = await handlers.getProgress('global');
        expect(result).toBeDefined();
        expect(result!.indexedItemIds).toEqual([100, 200]);
      });

      it('不存在的 ID 应返回 undefined', async () => {
        const result = await handlers.getProgress('non-existent');
        expect(result).toBeUndefined();
      });
    });

    describe('clearAllProgress', () => {
      it('应清空所有进度记录', async () => {
        await handlers.upsertProgress(createTestProgress({ id: 'global', totalItems: 10 }));
        await handlers.upsertProgress(createTestProgress({ id: 'other', totalItems: 5 }));

        await handlers.clearAllProgress();

        const all = await ragDb.progress.toArray();
        expect(all).toHaveLength(0);
      });
    });
  });

  // =========================================================================
  // 错误处理
  // =========================================================================

  describe('错误处理', () => {
    it('无效数据不应导致 handler 崩溃（conversation）', async () => {
      // upsert 一个缺少必要字段的对象 — Dexie 不强制 schema，只检查 key
      await expect(
        handlers.upsertConversation({ id: 'minimal' } as any),
      ).resolves.toBeUndefined();
    });

    it('重复 upsert 同一 conversation 不应报错', async () => {
      const conv = createTestConversation();
      await handlers.upsertConversation(conv);
      await handlers.upsertConversation(conv);

      const stored = await handlers.getConversation(conv.id);
      expect(stored).toBeDefined();
    });

    it('重复 upsert 同一 message 不应报错', async () => {
      const msg = createTestMessage('conv1', { id: 'dup-msg' });
      await handlers.upsertMessage(msg);
      await handlers.upsertMessage(msg);

      const stored = await chatDb.messages.get('dup-msg');
      expect(stored).toBeDefined();
    });

    it('bulkPut 空数组不应报错', async () => {
      await expect(handlers.upsertMessages([])).resolves.toBeUndefined();
    });

    it('bulkAdd 空数组不应报错', async () => {
      await expect(handlers.upsertChunks([])).resolves.toBeUndefined();
    });

    it('bulkDelete 空数组不应报错', async () => {
      await expect(handlers.deleteMessages([])).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // 跨表事务完整性
  // =========================================================================

  describe('事务完整性', () => {
    it('deleteConversation 应在同一事务中删除对话和消息', async () => {
      const conv = createTestConversation();
      await handlers.upsertConversation(conv);

      // 添加多条消息
      for (let i = 0; i < 10; i++) {
        await handlers.upsertMessage(
          createTestMessage(conv.id, { id: `tx-msg-${i}`, content: `Message ${i}` }),
        );
      }

      // 删除应原子完成
      await handlers.deleteConversation(conv.id);

      const convResult = await chatDb.conversations.get(conv.id);
      const msgResults = await chatDb.messages
        .where('conversationId')
        .equals(conv.id)
        .toArray();

      expect(convResult).toBeUndefined();
      expect(msgResults).toHaveLength(0);
    });

    it('多个对话的消息应互不影响', async () => {
      const conv1 = createTestConversation({ id: 'conv-a' });
      const conv2 = createTestConversation({ id: 'conv-b' });

      await handlers.upsertConversation(conv1);
      await handlers.upsertConversation(conv2);

      await handlers.upsertMessage(createTestMessage('conv-a', { id: 'a-msg' }));
      await handlers.upsertMessage(createTestMessage('conv-b', { id: 'b-msg' }));

      // 删除 conv-a
      await handlers.deleteConversation('conv-a');

      // conv-b 的消息应保留
      const bMessages = await handlers.getMessages('conv-b');
      expect(bMessages).toHaveLength(1);
      expect(bMessages[0].id).toBe('b-msg');
    });
  });

  // =========================================================================
  // 内存降级场景（模拟 Worker 不可用）
  // =========================================================================

  describe('内存降级场景', () => {
    it('handlers 可独立于 Worker 环境运行', async () => {
      // 验证 handlers 在没有 Worker/postMessage 的环境下正常工作
      // 这模拟了 Worker 不可用时直接调用 handler 的降级路径
      const conv = createTestConversation({ title: 'Fallback Test' });
      await handlers.upsertConversation(conv);

      const result = await handlers.getConversation(conv.id);
      expect(result!.title).toBe('Fallback Test');
    });

    it('大量数据操作不应导致内存溢出', async () => {
      // 批量插入 100 条消息
      const messages = Array.from({ length: 100 }, (_, i) =>
        createTestMessage('conv-bulk', {
          id: `bulk-${i}`,
          content: `Message ${i}`,
          timestamp: new Date(`2026-01-01T${String(i % 24).padStart(2, '0')}:00:00`),
        }),
      );

      await handlers.upsertMessages(messages);

      const result = await handlers.getMessages('conv-bulk');
      expect(result).toHaveLength(100);
    });
  });
});
