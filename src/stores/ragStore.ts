/**
 * RAG Store - 向量存储管理
 * 使用 Dexie 持久化文档块及其嵌入向量到 IndexedDB
 * 当 IndexedDB 不可用时（如 Zotero 9 sandbox），自动降级为内存存储
 */

import Dexie, { type EntityTable } from 'dexie';
import { createLogger } from '@/utils/logger';
import { createDexieOrFallback } from '@/db/fallback';

const logger = createLogger('ragStore');

// ========== 类型定义 ==========

/** 文档块定义（对应 Dexie chunks 表） */
export interface RagChunk {
  id?: number;
  itemId: number;
  itemTitle: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[];
  createdAt: Date;
}

/** 索引进度定义（对应 Dexie progress 表） */
export interface RagProgress {
  id: string;
  indexedItemIds: number[];
  totalItems: number;
}

// ========== Dexie 数据库定义 ==========

/**
 * ZoteroSeek RAG 数据库
 * 存储文档块、嵌入向量和索引进度
 */
class RagDatabase extends Dexie {
  chunks!: EntityTable<RagChunk, 'id'>;
  progress!: EntityTable<RagProgress, 'id'>;

  constructor() {
    super('ZoteroSeekRAG');
    this.version(1).stores({
      chunks: '++id, itemId, chunkIndex',
      progress: 'id',
    });
  }
}

// ========== 内存降级存储 ==========

const memoryChunks: RagChunk[] = [];
let memoryProgress: RagProgress = { id: 'global', indexedItemIds: [], totalItems: 0 };

function createMemoryChunksTable() {
  let nextId = 1;
  return {
    bulkAdd(items: RagChunk[]) {
      for (const item of items) {
        memoryChunks.push({ ...item, id: nextId++ });
      }
      return Promise.resolve();
    },
    where(_field: string) {
      return {
        equals(value: number) {
          return {
            toArray: () =>
              Promise.resolve(memoryChunks.filter((c) => (c as any)[_field] === value)),
          };
        },
      };
    },
    toArray() {
      return Promise.resolve([...memoryChunks]);
    },
    clear() {
      memoryChunks.length = 0;
      return Promise.resolve();
    },
  };
}

function createMemoryProgressTable() {
  return {
    get(_id: string) {
      return Promise.resolve(memoryProgress);
    },
    put(item: RagProgress) {
      memoryProgress = { ...item };
      return Promise.resolve();
    },
    clear() {
      memoryProgress = { id: 'global', indexedItemIds: [], totalItems: 0 };
      return Promise.resolve();
    },
  };
}

// ========== 数据库初始化 ==========

const { db, isAvailable: isDexieAvailable } = createDexieOrFallback({
  dbConstructor: RagDatabase,
  fallbackDb: {
    chunks: createMemoryChunksTable(),
    progress: createMemoryProgressTable(),
  } as any,
  storeName: 'RAG',
});

/** IndexedDB 是否可用 */
export { isDexieAvailable };

// ========== 导出函数 ==========

/**
 * 批量存储文档块
 * @param chunks - 文档块数组（可包含嵌入向量）
 */
export async function storeChunks(chunks: RagChunk[]): Promise<void> {
  try {
    await db.chunks.bulkAdd(chunks);
    logger.info('存储文档块', { count: chunks.length });
  } catch (error) {
    logger.error('存储文档块失败', error);
    throw error;
  }
}

/**
 * 根据 itemId 获取文档块
 * @param itemId - Zotero 条目 ID
 * @returns 匹配的文档块数组
 */
export async function getChunksByItemId(itemId: number): Promise<RagChunk[]> {
  try {
    const chunks = await db.chunks.where('itemId').equals(itemId).toArray();
    logger.debug('获取文档块', { itemId, count: chunks.length });
    return chunks;
  } catch (error) {
    logger.error('获取文档块失败', { itemId, error });
    throw error;
  }
}

/**
 * 获取所有文档块
 * @returns 全部文档块数组
 */
export async function getAllChunks(): Promise<RagChunk[]> {
  try {
    const chunks = await db.chunks.toArray();
    logger.debug('获取全部文档块', { count: chunks.length });
    return chunks;
  } catch (error) {
    logger.error('获取全部文档块失败', error);
    throw error;
  }
}

/**
 * 清除所有索引数据（文档块和进度）
 */
export async function clearIndex(): Promise<void> {
  try {
    await db.chunks.clear();
    await db.progress.clear();
    logger.info('清除索引完成');
  } catch (error) {
    logger.error('清除索引失败', error);
    throw error;
  }
}

/**
 * 获取索引进度
 * @returns 索引进度对象，若不存在则返回默认值
 */
export async function getProgress(): Promise<RagProgress> {
  try {
    const progress = await db.progress.get('global');
    if (progress) {
      return progress;
    }
    return { id: 'global', indexedItemIds: [], totalItems: 0 };
  } catch (error) {
    logger.error('获取索引进度失败', error);
    throw error;
  }
}

/**
 * 更新索引进度
 * @param progress - 索引进度对象
 */
export async function setProgress(progress: { indexedItemIds: number[]; totalItems: number }): Promise<void> {
  try {
    await db.progress.put({
      id: 'global',
      ...progress,
    });
    logger.info('更新索引进度', {
      indexedCount: progress.indexedItemIds.length,
      totalItems: progress.totalItems,
    });
  } catch (error) {
    logger.error('更新索引进度失败', error);
    throw error;
  }
}

export default db;
