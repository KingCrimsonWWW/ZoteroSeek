/**
 * LLM 适配器工厂
 * 根据模型配置创建对应的 LLM 适配器实例
 */

import { OpenAIAdapter } from '@/apis/llm/openai';
import { AnthropicAdapter } from '@/apis/llm/anthropic';
import type { LLMAdapter, ModelConfig } from '@/typings';

/**
 * 根据模型配置创建对应的 LLM 适配器
 */
export function createAdapter(config: ModelConfig): LLMAdapter {
  switch (config.provider) {
    case 'openai':
      return new OpenAIAdapter(config.apiKey, config.baseUrl, config.model);
    case 'anthropic':
      return new AnthropicAdapter(config);
    default:
      throw new Error(`不支持的 LLM 供应商: ${config.provider}`);
  }
}
