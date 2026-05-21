/**
 * OpenAI 适配器
 * 支持 OpenAI、DeepSeek、MiMo 等兼容接口的流式对话
 */

import type { LLMAdapter, ChatMessage, ChatOptions } from '@/typings';
import { createOpenAIClient } from '@/utils/http';
import { createLogger } from '@/utils/logger';

const logger = createLogger('openai');

/** 默认模型 */
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * OpenAI 适配器，实现 LLMAdapter 接口
 * 支持 OpenAI 兼容 API（OpenAI、DeepSeek、MiMo 等）
 */
export class OpenAIAdapter implements LLMAdapter {
  readonly name = 'openai';

  private apiKey: string;
  private baseURL?: string;
  private defaultModel: string;

  /**
   * @param apiKey - API 密钥
   * @param baseURL - 可选的基础 URL（用于 DeepSeek、MiMo 等兼容 API）
   * @param defaultModel - 默认模型名称
   */
  constructor(apiKey: string, baseURL?: string, defaultModel?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.defaultModel = defaultModel ?? DEFAULT_MODEL;
  }

  /**
   * 流式对话，逐 token 返回响应
   * @param messages - 对话消息列表
   * @param options - 可选配置（模型、温度、最大 token 等）
   * @param signal - 可选的 AbortSignal，用于中断请求
   * @returns 异步生成器，逐 token yield 响应内容
   */
  async *chat(
    messages: ChatMessage[],
    options?: ChatOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const model = options?.model ?? this.defaultModel;
    const temperature = options?.temperature;
    const maxTokens = options?.maxTokens;

    logger.info('开始对话', { model, messageCount: messages.length });

    try {
      const client = await createOpenAIClient(this.apiKey, this.baseURL);

      const response = await client.chat.completions.create(
        {
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          ...(temperature !== undefined && { temperature }),
          ...(maxTokens !== undefined && { max_tokens: maxTokens }),
        },
        { signal },
      );

      for await (const chunk of response) {
        // 检查中断信号
        if (signal?.aborted) {
          logger.info('对话被用户中断');
          return;
        }

        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }

      logger.info('对话完成');
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * 统一错误处理
   * 将 OpenAI SDK 错误转换为友好的错误消息
   */
  private handleError(error: unknown): never {
    // 中断请求不是真正的错误
    if (error instanceof DOMException && error.name === 'AbortError') {
      logger.info('对话被用户中断');
      throw error;
    }

    const err = error as Record<string, unknown>;
    const status = err?.status ?? err?.statusCode;
    const message = (err?.message as string) ?? '未知错误';

    if (status === 401) {
      logger.error('认证失败，请检查 API Key');
      throw new Error('认证失败：API Key 无效或已过期');
    }

    if (status === 429) {
      logger.error('请求过于频繁，请稍后再试');
      throw new Error('请求过于频繁：已触发速率限制，请稍后再试');
    }

    if (status === 404) {
      logger.error('模型不存在:', message);
      throw new Error(`模型不存在：${message}`);
    }

    logger.error('对话请求失败:', message);
    throw new Error(`对话请求失败：${message}`);
  }
}
