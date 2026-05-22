/**
 * RAG 系统集成测试
 *
 * 测试 RAG 管道的核心组件：ragStore、retriever、chatIntegration。
 * 使用 fake-indexeddb 提供 IndexedDB 支持，mock 所有外部依赖。
 */

import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Mock dependencies
// =============================================================================

// Logger（避免 Zotero.log 未定义）
vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Embeddings API（避免真实 OpenAI 调用）
const mockCreateEmbedding = vi.fn();
const mockCreateEmbeddings = vi.fn();

vi.mock("@/apis/llm/embeddings", () => ({
  createEmbedding: (...args: unknown[]) => mockCreateEmbedding(...args),
  createEmbeddings: (...args: unknown[]) => mockCreateEmbeddings(...args),
}));

// =============================================================================
// Import after mocks
// =============================================================================

import {
  storeChunks,
  getAllChunks,
  clearIndex,
  getChunksByItemId,
  getProgress,
  setProgress,
  type RagChunk,
} from "@/stores/ragStore";
import { search } from "@/services/rag/retriever";
import { augmentMessage } from "@/services/rag/chatIntegration";

// =============================================================================
// Test data
// =============================================================================

/** 创建测试用 RagChunk */
function createTestChunk(
  overrides: Partial<RagChunk> = {},
): RagChunk {
  return {
    itemId: 1,
    itemTitle: "Test Paper",
    chunkIndex: 0,
    chunkText: "This is a test chunk about machine learning.",
    embedding: [1, 0, 0],
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/** 创建多个测试用 RagChunk（不同嵌入向量） */
function createTestChunks(): RagChunk[] {
  return [
    createTestChunk({
      itemId: 1,
      itemTitle: "Paper A",
      chunkIndex: 0,
      chunkText: "Content about deep learning and neural networks.",
      embedding: [1, 0, 0], // 与查询 [1,0,0] 完全匹配
    }),
    createTestChunk({
      itemId: 2,
      itemTitle: "Paper B",
      chunkIndex: 0,
      chunkText: "Content about natural language processing.",
      embedding: [0.5, 0.866, 0], // 与查询部分匹配
    }),
    createTestChunk({
      itemId: 3,
      itemTitle: "Paper C",
      chunkIndex: 0,
      chunkText: "Content about computer vision.",
      embedding: [0, 1, 0], // 与查询正交
    }),
  ];
}

// =============================================================================
// Tests
// =============================================================================

describe("RAG 系统集成测试", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // 清空 IndexedDB（每个测试独立）
    await clearIndex();
  });

  // ---------------------------------------------------------------------------
  // ragStore
  // ---------------------------------------------------------------------------

  describe("ragStore", () => {
    it("storeChunks + getAllChunks 往返：存储后可完整读取", async () => {
      // Arrange
      const chunks = createTestChunks();

      // Act
      await storeChunks(chunks);
      const retrieved = await getAllChunks();

      // Assert
      expect(retrieved).toHaveLength(3);
      expect(retrieved[0].itemTitle).toBe("Paper A");
      expect(retrieved[1].itemTitle).toBe("Paper B");
      expect(retrieved[2].itemTitle).toBe("Paper C");
      expect(retrieved[0].embedding).toEqual([1, 0, 0]);
      expect(retrieved[0].chunkText).toContain("deep learning");
    });

    it("clearIndex 清空所有数据", async () => {
      // Arrange: 先存储数据
      await storeChunks(createTestChunks());
      const before = await getAllChunks();
      expect(before).toHaveLength(3);

      // Act
      await clearIndex();
      const after = await getAllChunks();

      // Assert
      expect(after).toHaveLength(0);
    });

    it("getChunksByItemId 按 itemId 筛选", async () => {
      // Arrange
      const chunks = [
        createTestChunk({ itemId: 1, itemTitle: "Paper A", chunkIndex: 0 }),
        createTestChunk({ itemId: 1, itemTitle: "Paper A", chunkIndex: 1 }),
        createTestChunk({ itemId: 2, itemTitle: "Paper B", chunkIndex: 0 }),
      ];
      await storeChunks(chunks);

      // Act
      const result = await getChunksByItemId(1);

      // Assert
      expect(result).toHaveLength(2);
      expect(result.every((c) => c.itemId === 1)).toBe(true);
    });

    it("getProgress / setProgress 正确管理索引进度", async () => {
      // Arrange: 默认进度
      const initial = await getProgress();
      expect(initial.indexedItemIds).toEqual([]);
      expect(initial.totalItems).toBe(0);

      // Act: 更新进度
      await setProgress({ indexedItemIds: [101, 102], totalItems: 10 });
      const updated = await getProgress();

      // Assert
      expect(updated.indexedItemIds).toEqual([101, 102]);
      expect(updated.totalItems).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // retriever
  // ---------------------------------------------------------------------------

  describe("retriever", () => {
    it("search 返回按相似度降序排列的结果", async () => {
      // Arrange: 存储测试数据
      await storeChunks(createTestChunks());

      // Mock 查询嵌入向量（与 Paper A 完全匹配）
      mockCreateEmbedding.mockResolvedValue([1, 0, 0]);

      // Act
      const results = await search("machine learning", "test-api-key");

      // Assert
      expect(results).toHaveLength(3);

      // 验证排序：Paper A > Paper B > Paper C
      expect(results[0].itemTitle).toBe("Paper A");
      expect(results[1].itemTitle).toBe("Paper B");
      expect(results[2].itemTitle).toBe("Paper C");

      // 验证分数单调递减
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);

      // Paper A 完全匹配，分数应为 1.0
      expect(results[0].score).toBeCloseTo(1.0, 4);
    });

    it("search 在空索引时返回空数组", async () => {
      // Arrange: 不存储任何数据
      mockCreateEmbedding.mockResolvedValue([1, 0, 0]);

      // Act
      const results = await search("any query", "test-api-key");

      // Assert
      expect(results).toEqual([]);
    });

    it("search 正确传递 topK 参数", async () => {
      // Arrange
      await storeChunks(createTestChunks());
      mockCreateEmbedding.mockResolvedValue([1, 0, 0]);

      // Act
      const results = await search("test", "test-api-key", 2);

      // Assert
      expect(results).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // chatIntegration
  // ---------------------------------------------------------------------------

  describe("chatIntegration", () => {
    it("augmentMessage 正确格式化上下文", async () => {
      // Arrange: 存储测试数据
      await storeChunks(createTestChunks());
      mockCreateEmbedding.mockResolvedValue([1, 0, 0]);

      // Act
      const result = await augmentMessage("machine learning", "test-api-key");

      // Assert
      expect(result.sources).toHaveLength(3);
      expect(result.context).toContain("以下是与用户问题相关的文献片段");
      expect(result.context).toContain("[1] 《Paper A》");
      expect(result.context).toContain("[2] 《Paper B》");
      expect(result.context).toContain("[3] 《Paper C》");
      expect(result.context).toContain("deep learning");
    });

    it("augmentMessage 无结果时返回空 context", async () => {
      // Arrange: 空索引
      mockCreateEmbedding.mockResolvedValue([1, 0, 0]);

      // Act
      const result = await augmentMessage("any query", "test-api-key");

      // Assert
      expect(result.context).toBe("");
      expect(result.sources).toEqual([]);
    });

    it("augmentMessage 检索失败时降级为空结果", async () => {
      // Arrange: 模拟嵌入 API 失败
      mockCreateEmbedding.mockRejectedValue(new Error("API Error"));

      // Act
      const result = await augmentMessage("test query", "test-api-key");

      // Assert: 降级处理，不抛异常
      expect(result.context).toBe("");
      expect(result.sources).toEqual([]);
    });
  });
});
