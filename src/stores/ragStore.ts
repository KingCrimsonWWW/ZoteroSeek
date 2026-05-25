/**
 * RAG Store - 向量存储管理
 * 通过 Web Worker 持久化文档块及其嵌入向量到 IndexedDB
 * 当 Worker 不可用时（如测试环境），自动降级为内存存储
 */

import { createLogger } from '@/utils/logger';
import {
  upsertChunks as workerUpsertChunks,
  getChunksByItem as workerGetChunksByItem,
  getAllChunks as workerGetAllChunks,
  clearAllChunks as workerClearAllChunks,
  getProgress as workerGetProgress,
  upsertProgress as workerUpsertProgress,
  clearAllProgress as workerClearAllProgress,
} from '@/db/client';

const logger = createLogger('ragStore');

// ========== 类型定义 ==========

/** 文档块定义（对应 IndexedDB chunks 表） */
export interface RagChunk {
  id?: number;
  itemId: number;
  itemTitle: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[];
  createdAt: Date;
}

/** 索引进度定义（对应 IndexedDB progress 表） */
export interface RagProgress {
  id: string;
  indexedItemIds: number[];
  totalItems: number;
}

// ========== 内存降级存储 ==========

const memoryChunks: RagChunk[] = [];
let nextChunkId = 1;
let memoryProgress: RagProgress = { id: 'global', indexedItemIds: [], totalItems: 0 };

// ========== Worker 可用性检测 ==========

let workerAvailable: boolean | null = null;

/**
 * 检测 Worker 是否可用（懒初始化，仅首次调用执行探测）
 * Worker 可用 → 使用 IndexedDB 持久化
 * Worker 不可用 → 降级为内存存储
 */
async function ensureWorker(): Promise<boolean> {
  if (workerAvailable !== null) return workerAvailable;
  try {
    // 使用轻量级调用探测 Worker 是否存活
    await workerGetAllChunks();
    workerAvailable = true;
    isDexieAvailable = true;
    logger.info('RAG: Worker 可用，使用 Worker 持久化');
  } catch {
    workerAvailable = false;
    isDexieAvailable = false;
    logger.warn('RAG: Worker 不可用，使用内存降级存储');
  }
  return workerAvailable;
}

/** IndexedDB（通过 Worker）是否可用 */
export let isDexieAvailable = true;

// ========== 导出函数 ==========

/**
 * 批量存储文档块
 * @param chunks - 文档块数组（可包含嵌入向量）
 */
export async function storeChunks(chunks: RagChunk[]): Promise<void> {
  try {
    if (await ensureWorker()) {
      await workerUpsertChunks(chunks);
    } else {
      for (const chunk of chunks) {
        memoryChunks.push({ ...chunk, id: nextChunkId++ });
      }
    }
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
    let chunks: RagChunk[];
    if (await ensureWorker()) {
      chunks = await workerGetChunksByItem(itemId);
    } else {
      chunks = memoryChunks.filter((c) => c.itemId === itemId);
    }
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
    let chunks: RagChunk[];
    if (await ensureWorker()) {
      chunks = await workerGetAllChunks();
    } else {
      chunks = [...memoryChunks];
    }
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
    if (await ensureWorker()) {
      await workerClearAllChunks();
      await workerClearAllProgress();
    } else {
      memoryChunks.length = 0;
      memoryProgress = { id: 'global', indexedItemIds: [], totalItems: 0 };
    }
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
    if (await ensureWorker()) {
      const progress = await workerGetProgress('global');
      if (progress) return progress;
      return { id: 'global', indexedItemIds: [], totalItems: 0 };
    }
    return memoryProgress;
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
    const fullProgress: RagProgress = { id: 'global', ...progress };
    if (await ensureWorker()) {
      await workerUpsertProgress(fullProgress);
    } else {
      memoryProgress = { ...fullProgress };
    }
    logger.info('更新索引进度', {
      indexedCount: progress.indexedItemIds.length,
      totalItems: progress.totalItems,
    });
  } catch (error) {
    logger.error('更新索引进度失败', error);
    throw error;
  }
}
