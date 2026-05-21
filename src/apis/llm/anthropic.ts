/**
 * Anthropic LLM 适配器
 * 使用原生 HTTP 请求与 Anthropic Messages API 通信
 */

import type { LLMAdapter, ChatMessage, ChatOptions, ModelConfig } from "@/typings";
import { zoteroHTTPRequest, parseSSEStream } from "@/utils/http";
import { createLogger } from "@/utils/logger";

const logger = createLogger("anthropic");

/** Anthropic API 默认配置 */
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION = "2023-06-01";

/** Anthropic SSE 事件类型 */
interface AnthropicContentBlockDelta {
  type: "content_block_delta";
  index: number;
  delta: {
    type: "text_delta";
    text: string;
  };
}

/** Anthropic 错误响应格式 */
interface AnthropicErrorResponse {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

/**
 * Anthropic 适配器
 * 实现 LLMAdapter 接口，使用原生 HTTP 请求与 Anthropic Messages API 通信
 */
export class AnthropicAdapter implements LLMAdapter {
  readonly name = "anthropic";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: ModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl || ANTHROPIC_DEFAULT_BASE_URL;
    logger.info("AnthropicAdapter 初始化", { model: this.model, baseUrl: this.baseUrl });
  }

  /**
   * 发送聊天请求并返回流式响应
   *
   * Anthropic 要求 system 消息通过顶层 `system` 字段传递，
   * 而非放在 messages 数组中。本方法自动分离 system 消息。
   *
   * @param messages - 聊天消息数组
   * @param options - 聊天选项（model、temperature、maxTokens）
   * @returns AsyncGenerator 逐 token 返回响应文本
   */
  async *chat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
    const model = options?.model || this.model;
    const maxTokens = options?.maxTokens || 1024;
    const temperature = options?.temperature;

    // 分离 system 消息和其他消息
    const systemParts: string[] = [];
    const chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemParts.push(msg.content);
      } else {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // 构建请求体
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: chatMessages,
      stream: true,
    };

    if (systemParts.length > 0) {
      body.system = systemParts.join("\n");
    }

    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    logger.debug("发送聊天请求", {
      model,
      maxTokens,
      messageCount: chatMessages.length,
      hasSystem: systemParts.length > 0,
    });

    try {
      const url = `${this.baseUrl}/v1/messages`;
      const headers: Record<string, string> = {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };

      const response = await zoteroHTTPRequest("POST", url, {
        headers,
        body: JSON.stringify(body),
      });

      // 处理 HTTP 错误状态码
      if (response.status === 401) {
        throw new Error("Anthropic API 认证失败：无效的 API 密钥");
      }
      if (response.status === 429) {
        throw new Error("Anthropic API 速率限制：请求过于频繁，请稍后重试");
      }
      if (response.status !== 200) {
        const errorMsg = this.parseErrorMessage(response.status, response.statusText, response.body);
        throw new Error(errorMsg);
      }

      // 解析 SSE 流并逐 token yield
      const chunks = parseSSEStream(response.body);

      for (const chunk of chunks) {
        if (chunk.done) {
          break;
        }

        if (!chunk.parsed) {
          continue;
        }

        const data = chunk.parsed as Record<string, unknown>;

        // 只处理 content_block_delta 事件中的文本增量
        if (data.type === "content_block_delta") {
          const delta = data.delta as AnthropicContentBlockDelta["delta"] | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            yield delta.text;
          }
        }
      }

      logger.debug("聊天请求完成");
    } catch (error) {
      const err = error as Error;
      logger.error("聊天请求失败", err.message);
      throw err;
    }
  }

  /**
   * 解析 Anthropic 错误响应
   * @param status - HTTP 状态码
   * @param statusText - HTTP 状态文本
   * @param body - 响应体
   * @returns 格式化的错误消息
   */
  private parseErrorMessage(status: number, statusText: string, body: string): string {
    try {
      const errorBody = JSON.parse(body) as AnthropicErrorResponse;
      if (errorBody.error?.message) {
        return `Anthropic API 错误 (${status}): ${errorBody.error.message}`;
      }
    } catch {
      // JSON 解析失败，使用默认消息
    }
    return `Anthropic API 错误: ${status} ${statusText}`;
  }
}
