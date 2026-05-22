/**
 * RAG 索引器服务
 * 扫描整个 Zotero 库，提取 PDF 文本，分块，生成嵌入向量，存储到 ragStore
 *
 * 核心流程：
 * 1. 获取所有带有 PDF 附件的 Zotero 条目
 * 2. 对每个未索引条目：提取 PDF 文本 → 分块 → 生成嵌入 → 存储
 * 3. 处理速率限制（指数退避重试）
 * 4. 支持恢复（跳过已索引条目）和优雅停止
 */

import { createLogger } from '@/utils/logger';
import { createEmbeddings } from '@/apis/llm/embeddings';
import { extractText } from '@/services/pdf/extractor';
import { getPDFPath, getItemMetadata } from '@/apis/zotero/index';
import { storeChunks, getProgress, setProgress, type RagChunk } from '@/stores/ragStore';

const logger = createLogger('rag-indexer');

// ============================================================================
// 模块级状态
// ============================================================================

/** 当前是否正在索引 */
let isRunning = false;

/** 当前索引进度快照 */
let currentProgress = { current: 0, total: 0 };

// ============================================================================
// 文本分块
// ============================================================================

/**
 * 将文本按段落分割，合并小段落直到达到目标大小。
 * 相邻块之间有 ~100 字符重叠以保持上下文连续性。
 *
 * 策略：
 * 1. 按双换行（段落）分割
 * 2. 顺序累积段落，超过 1000 字符时输出当前块
 * 3. 新块以旧块尾部 100 字符开头，实现重叠
 *
 * @param text - 输入文本
 * @param maxChars - 每块最大字符数（默认 1000）
 * @param overlapChars - 相邻块重叠字符数（默认 100）
 * @returns 文本块数组
 */
function chunkText(text: string, maxChars = 1000, overlapChars = 100): string[] {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const separator = current ? '\n\n' : '';
    if (current.length + separator.length + para.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      // 重叠：新块以当前块尾部 overlapChars 字符开头
      const overlap = current.length > overlapChars ? current.slice(-overlapChars) : current;
      current = overlap + '\n\n' + para;
    } else {
      current += separator + para;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

// ============================================================================
// 速率限制处理（指数退避）
// ============================================================================

/** 暂停指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 检查是否为 429 速率限制错误 */
function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Rate limit exceeded';
}

/**
 * 带指数退避重试的嵌入向量生成
 *
 * 退避序列：1s → 2s → 4s → 8s → 16s → 最大 30s
 *
 * @param texts - 输入文本数组
 * @param apiKey - API 密钥
 * @param baseUrl - 可选 API 基础 URL
 * @param model - 可选模型名称
 * @param maxRetries - 最大重试次数（默认 5）
 * @returns 嵌入向量数组
 */
async function createEmbeddingsWithRetry(
  texts: string[],
  apiKey: string,
  baseUrl?: string,
  model?: string,
  maxRetries = 5,
): Promise<number[][]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await createEmbeddings(texts, apiKey, baseUrl, model);
    } catch (error: unknown) {
      if (isRateLimitError(error) && attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 30000);
        logger.warn(`速率限制触发，${delay}ms 后重试（第 ${attempt + 1}/${maxRetries} 次）`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error('超出最大重试次数，嵌入向量生成失败');
}

// ============================================================================
// Zotero 条目查询辅助函数
// ============================================================================

/** 获取所有 PDF 附件类型的 Zotero 条目 */
function getPdfAttachmentItems(): any[] {
  // Zotero.Items 类型定义未包含 getAll，运行时存在此方法
  const allItems: any[] = (Zotero.Items as any).getAll();
  return allItems.filter((item: any) => {
    try {
      return item.isAttachment?.() && item.attachmentContentType === 'application/pdf';
    } catch {
      return false;
    }
  });
}

/** 获取条目的显示标题（优先使用父条目标题） */
function getItemTitle(attachmentItem: any): string {
  try {
    if (attachmentItem.parentID) {
      const parentMeta = getItemMetadata(attachmentItem.parentID);
      if (parentMeta.title) return parentMeta.title;
    }
  } catch {
    // 获取父条目信息失败，使用附件自身标题
  }
  return attachmentItem.getField?.('title') || `Item ${attachmentItem.id}`;
}

// ============================================================================
// 进度跟踪辅助函数
// ============================================================================

/**
 * 标记条目为已索引。
 * 读取当前进度，追加条目 ID，写回存储。
 */
async function markItemIndexed(itemId: number): Promise<void> {
  const progress = await getProgress();
  if (!progress.indexedItemIds.includes(itemId)) {
    progress.indexedItemIds.push(itemId);
    await setProgress(progress);
  }
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 开始全库索引。
 * 扫描所有 Zotero 条目，为每个带 PDF 附件的条目提取文本、分块、生成嵌入并存储。
 *
 * 如果已有索引进度，自动跳过已索引条目（恢复支持）。
 * 同一时间只允许一个索引任务运行；重复调用将被忽略。
 *
 * @param apiKey - LLM API 密钥（必填）
 * @param baseUrl - 可选 API 基础 URL
 * @param model - 可选嵌入模型名称，默认 text-embedding-3-small
 */
export async function startIndexing(
  apiKey: string,
  baseUrl?: string,
  model?: string,
): Promise<void> {
  if (isRunning) {
    logger.warn('索引已在进行中，忽略重复调用');
    return;
  }

  if (!apiKey) {
    throw new Error('索引需要 API Key');
  }

  isRunning = true;

  try {
    logger.info('开始全库索引');

    // 1. 获取所有 PDF 附件条目
    const pdfItems = getPdfAttachmentItems();
    const allItemIds = pdfItems.map((item: any) => item.id);
    logger.info(`找到 ${pdfItems.length} 个 PDF 附件`);

    // 2. 获取已索引的条目列表
    const progress = await getProgress();
    const indexedIds = new Set(progress.indexedItemIds);

    // 3. 筛选未索引的条目
    const toIndex = pdfItems.filter((item: any) => !indexedIds.has(item.id));
    const total = toIndex.length;

    // 更新进度：设置总数，保持已索引列表不变
    await setProgress({
      indexedItemIds: progress.indexedItemIds,
      totalItems: allItemIds.length,
    });

    currentProgress = { current: 0, total };
    logger.info(`需要索引 ${total} 个条目（${indexedIds.size} 个已跳过）`);

    if (total === 0) {
      logger.info('所有条目已索引，无需操作');
      return;
    }

    // 4. 逐条处理
    for (let i = 0; i < toIndex.length; i++) {
      if (!isRunning) {
        logger.info('索引已被外部停止');
        break;
      }

      const item = toIndex[i];
      const itemId: number = item.id;
      const logPrefix = `[${i + 1}/${total}]`;

      logger.info(`${logPrefix} 索引条目`, { itemId });

      try {
        // a. 获取 PDF 路径
        const pdfPath = await getPDFPath(itemId);
        if (!pdfPath) {
          logger.warn(`${logPrefix} 无法获取 PDF 路径，跳过`, { itemId });
          await markItemIndexed(itemId);
          continue;
        }

        // b. 提取文本
        const { fullText } = await extractText(pdfPath);
        if (!fullText || fullText.trim().length === 0) {
          logger.warn(`${logPrefix} PDF 文本为空，跳过`, { itemId });
          await markItemIndexed(itemId);
          continue;
        }

        // c. 分块
        const chunks = chunkText(fullText);
        logger.info(`${logPrefix} 文本已分块`, { itemId, chunkCount: chunks.length });

        if (chunks.length === 0) {
          logger.warn(`${logPrefix} 分块结果为空，跳过`, { itemId });
          await markItemIndexed(itemId);
          continue;
        }

        // d. 生成嵌入向量（批量处理，每次最多 20 个以避免单次请求过大）
        const embeddings: number[][] = [];
        const batchSize = 20;
        for (let j = 0; j < chunks.length; j += batchSize) {
          if (!isRunning) break;
          const batch = chunks.slice(j, j + batchSize);
          const batchEmbeddings = await createEmbeddingsWithRetry(batch, apiKey, baseUrl, model);
          embeddings.push(...batchEmbeddings);
        }

        if (!isRunning) break;

        // e. 获取显示标题
        const itemTitle = getItemTitle(item);

        // f. 构建 RagChunk 数组并批量存储
        const ragChunks: RagChunk[] = chunks.map((chunkText, idx) => ({
          itemId,
          itemTitle,
          chunkIndex: idx,
          chunkText,
          embedding: embeddings[idx] || [],
          createdAt: new Date(),
        }));

        await storeChunks(ragChunks);
        logger.info(`${logPrefix} 已存储 ${ragChunks.length} 个文档块`, { itemId });

        // g. 更新进度
        await markItemIndexed(itemId);
        currentProgress.current = i + 1;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`${logPrefix} 索引条目失败，继续下一个`, { itemId, error: msg });
        // 失败条目不标记为已索引，下次运行会重试
      }
    }

    logger.info('全库索引流程完成');
  } finally {
    isRunning = false;
    currentProgress = { current: 0, total: 0 };
  }
}

/**
 * 获取当前索引进度。
 *
 * @returns 包含 current（已处理数）、total（总数）和 isRunning（是否运行中）的对象
 */
export function getIndexingProgress(): { current: number; total: number; isRunning: boolean } {
  return { ...currentProgress, isRunning };
}

/**
 * 优雅停止正在进行的索引任务。
 * 正在处理的当前条目会完成，之后不再处理新条目。
 * 已存储的数据和进度会被保留。
 */
export function stopIndexing(): void {
  if (isRunning) {
    logger.info('收到停止索引请求');
    isRunning = false;
  }
}
