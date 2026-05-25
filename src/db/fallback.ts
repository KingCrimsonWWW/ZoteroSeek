/**
 * IndexedDB 可用性检测 + 内存降级工厂
 *
 * Zotero 9 sandbox 中 IndexedDB 不可用，此工厂提供统一的检测与降级逻辑，
 * 避免 chatStore / ragStore 各自重复相同的 try-catch 代码。
 *
 * 用法：
 * ```ts
 * const { db, isAvailable } = createDexieOrFallback({
 *   dbConstructor: ChatDatabase,
 *   fallbackDb: memoryDb,
 *   storeName: 'Chat',
 * });
 * ```
 */

import Dexie from 'dexie';
import { createLogger } from '@/utils/logger';

const logger = createLogger('db-fallback');

interface CreateDexieOrFallbackOptions<T extends Dexie> {
  /** Dexie 子类构造函数（如 ChatDatabase、RagDatabase） */
  dbConstructor: new () => T;
  /** IndexedDB 不可用时使用的内存降级对象，结构与 Dexie 实例一致 */
  fallbackDb: T;
  /** 日志标识，如 'Chat'、'RAG' */
  storeName: string;
}

interface CreateDexieOrFallbackResult<T extends Dexie> {
  /** 最终可用的数据库实例（真实 Dexie 或内存降级） */
  db: T;
  /** IndexedDB 是否可用（UI 可据此显示警告） */
  isAvailable: boolean;
}

/**
 * 统一的 Dexie 初始化 + IndexedDB 降级工厂
 *
 * 检测流程：
 * 1. `typeof indexedDB === 'undefined'` → Zotero 9 sandbox，直接降级
 * 2. `new DbConstructor()` 抛异常 → IndexedDB 存在但不可用，降级
 * 3. 成功 → 使用真实 Dexie 实例
 */
export function createDexieOrFallback<T extends Dexie>(
  options: CreateDexieOrFallbackOptions<T>,
): CreateDexieOrFallbackResult<T> {
  const { dbConstructor, fallbackDb, storeName } = options;

  // Step 1: 检查 IndexedDB 是否在全局作用域中存在
  if (typeof indexedDB === 'undefined') {
    logger.warn(
      `[ZoteroSeek] IndexedDB not available, using in-memory storage for ${storeName}`,
    );
    return { db: fallbackDb, isAvailable: false };
  }

  // Step 2: 尝试构造 Dexie 实例（构造函数可能抛出安全错误）
  try {
    const db = new dbConstructor();
    return { db, isAvailable: true };
  } catch (error) {
    logger.warn(
      `[ZoteroSeek] IndexedDB not available, using in-memory storage for ${storeName}`,
      error,
    );
    return { db: fallbackDb, isAvailable: false };
  }
}
