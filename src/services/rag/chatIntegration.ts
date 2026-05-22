/**
 * RAG 对话集成 - 将检索到的文献片段注入 LLM 上下文
 */

import { search, type SearchResult } from '@/services/rag/retriever';
import { createLogger } from '@/utils/logger';

const logger = createLogger('rag-chat-integration');

export interface AugmentResult {
  /** 拼接好的上下文字符串，无结果时为空字符串 */
  context: string;
  /** 检索到的原始结果 */
  sources: SearchResult[];
}

/**
 * 根据用户消息检索相关文献片段，并格式化为可注入 system prompt 的上下文
 *
 * @param query - 用户消息文本
 * @param apiKey - OpenAI API 密钥（用于生成嵌入向量）
 * @param topK - 返回结果数量，默认 3
 * @param baseUrl - 可选的 API 基础 URL
 * @param model - 可选的嵌入模型名称
 * @returns 包含 context 和 sources 的对象
 */
export async function augmentMessage(
  query: string,
  apiKey: string,
  topK: number = 3,
  baseUrl?: string,
  model?: string,
): Promise<AugmentResult> {
  try {
    const results = await search(query, apiKey, topK, baseUrl, model);

    if (results.length === 0) {
      logger.debug('未检索到相关文献');
      return { context: '', sources: [] };
    }

    const contextParts = results.map(
      (r, i) => `[${i + 1}] 《${r.itemTitle}》: ${r.chunkText}`,
    );

    const context = `以下是与用户问题相关的文献片段：\n\n${contextParts.join('\n\n')}`;

    logger.info('RAG 上下文已生成', {
      sourceCount: results.length,
      contextLength: context.length,
    });

    return { context, sources: results };
  } catch (error) {
    logger.warn('RAG 检索失败，降级为普通对话', (error as Error).message);
    return { context: '', sources: [] };
  }
}
