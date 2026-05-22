/**
 * RAG Retriever - 语义搜索检索器
 * 基于余弦相似度在已索引的文档块中进行向量搜索
 */

import { createEmbedding } from '@/apis/llm/embeddings';
import { getAllChunks } from '@/stores/ragStore';
import { createLogger } from '@/utils/logger';

const logger = createLogger('rag-retriever');

/** 默认返回结果数量 */
const DEFAULT_TOP_K = 5;

/**
 * 搜索结果
 */
export interface SearchResult {
  /** 来源文档标题 */
  itemTitle: string;
  /** 匹配的文本块 */
  chunkText: string;
  /** 相似度分数（0-1） */
  score: number;
}

/**
 * 计算两个向量的余弦相似度
 * @param a - 向量 a
 * @param b - 向量 b
 * @returns 相似度分数（0-1），零向量返回 0
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  // 使用 Float32Array 提升大量向量计算的性能
  const vecA = new Float32Array(a);
  const vecB = new Float32Array(b);

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  // 处理零向量边界情况
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  // 余弦相似度范围为 [-1, 1]，将其归一化到 [0, 1]
  const similarity = dotProduct / denominator;
  return (similarity + 1) / 2;
}

/**
 * 语义搜索：在已索引的文档块中查找与查询最相关的结果
 *
 * @param query - 搜索查询文本
 * @param apiKey - OpenAI API 密钥
 * @param topK - 返回结果数量，默认 5
 * @param baseUrl - 可选的 API 基础 URL
 * @param model - 可选的嵌入模型名称
 * @returns 按相似度降序排列的搜索结果数组
 */
export async function search(
  query: string,
  apiKey: string,
  topK: number = DEFAULT_TOP_K,
  baseUrl?: string,
  model?: string,
): Promise<SearchResult[]> {
  logger.info('开始语义搜索', { query: query.substring(0, 100), topK });

  // 1. 生成查询的嵌入向量
  const queryEmbedding = await createEmbedding(query, apiKey, baseUrl, model);

  // 2. 从 ragStore 加载所有文档块
  const chunks = await getAllChunks();

  if (chunks.length === 0) {
    logger.info('索引为空，无搜索结果');
    return [];
  }

  logger.info('已加载文档块', { count: chunks.length });

  // 3. 计算查询与每个文档块的余弦相似度
  const results: SearchResult[] = chunks.map((chunk) => ({
    itemTitle: chunk.itemTitle,
    chunkText: chunk.chunkText,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  // 4. 按相似度降序排序，返回 top K 结果
  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, topK);

  logger.info('搜索完成', {
    totalChunks: chunks.length,
    returnedCount: topResults.length,
    topScore: topResults[0]?.score.toFixed(4),
  });

  return topResults;
}
