/**
 * OpenAI Embedding 适配器
 * 调用 OpenAI Embeddings API 生成文本向量嵌入
 */

import { createLogger } from '@/utils/logger';

const logger = createLogger('embeddings');

/** 默认嵌入模型 */
const DEFAULT_MODEL = 'text-embedding-3-small';

/** 默认 OpenAI API 基础 URL */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * 生成单个文本的嵌入向量
 * @param text - 输入文本
 * @param apiKey - OpenAI API 密钥
 * @param baseURL - 可选的基础 URL（用于兼容 API）
 * @param model - 可选模型名称，默认 text-embedding-3-small
 * @returns 嵌入向量（number[]）
 */
export async function createEmbedding(
  text: string,
  apiKey: string,
  baseURL?: string,
  model?: string,
): Promise<number[]> {
  const result = await createEmbeddings([text], apiKey, baseURL, model);
  return result[0];
}

/**
 * 批量生成文本嵌入向量
 * @param texts - 输入文本数组
 * @param apiKey - OpenAI API 密钥
 * @param baseURL - 可选的基础 URL（用于兼容 API）
 * @param model - 可选模型名称，默认 text-embedding-3-small
 * @returns 嵌入向量数组，按输入顺序排列
 */
export async function createEmbeddings(
  texts: string[],
  apiKey: string,
  baseURL?: string,
  model?: string,
): Promise<number[][]> {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const resolvedBaseURL = baseURL ?? DEFAULT_BASE_URL;

  logger.info('生成嵌入向量', { model: resolvedModel, count: texts.length });

  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey,
      baseURL: resolvedBaseURL,
      dangerouslyAllowBrowser: false,
    });

    const response = await client.embeddings.create({
      model: resolvedModel,
      input: texts,
    });

    logger.info('嵌入向量生成完成', { count: response.data.length });

    // 按 index 排序以保持输入顺序
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  } catch (error: unknown) {
    return handleError(error);
  }
}

/**
 * 统一错误处理
 * 将 OpenAI SDK 错误转换为友好的错误消息
 */
function handleError(error: unknown): never {
  if (error instanceof DOMException && error.name === 'AbortError') {
    logger.info('请求被中断');
    throw error;
  }

  const err = error as Record<string, unknown>;
  const status = err?.status ?? err?.statusCode;
  const message = (err?.message as string) ?? '未知错误';

  if (status === 401) {
    logger.error('认证失败，请检查 API Key');
    throw new Error('Authentication failed');
  }

  if (status === 429) {
    logger.error('请求过于频繁，请稍后再试');
    throw new Error('Rate limit exceeded');
  }

  logger.error('嵌入向量生成失败:', message);
  throw new Error(`Embedding failed: ${message}`);
}
