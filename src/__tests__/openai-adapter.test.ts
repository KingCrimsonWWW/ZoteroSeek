/**
 * OpenAI 适配器单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock createOpenAIClient
vi.mock('@/utils/http', () => ({
  createOpenAIClient: vi.fn(),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { OpenAIAdapter } from '@/apis/llm/openai';
import { createOpenAIClient } from '@/utils/http';

// 辅助函数：创建模拟的流式响应
function createMockStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield {
          choices: [{ delta: { content: chunk } }],
        };
      }
    },
  };
}

// 辅助函数：创建空 delta 的流（模拟无内容的 chunk）
function createMockStreamWithEmptyDelta() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: {} }] };
      yield { choices: [{ delta: { content: 'hello' } }] };
      yield { choices: [{}] };
      yield { choices: [{ delta: { content: ' world' } }] };
    },
  };
}

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  const mockCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter('test-api-key');
    (createOpenAIClient as any).mockResolvedValue({
      chat: { completions: { create: mockCreate } },
    });
  });

  describe('构造函数', () => {
    it('应使用默认模型', () => {
      const a = new OpenAIAdapter('key');
      expect(a.name).toBe('openai');
    });

    it('应接受自定义 baseURL 和 model', () => {
      const a = new OpenAIAdapter('key', 'https://custom.api.com/v1', 'deepseek-chat');
      expect(a.name).toBe('openai');
    });
  });

  describe('chat 方法', () => {
    it('应流式返回响应内容', async () => {
      mockCreate.mockResolvedValue(createMockStream(['Hello', ' ', 'World']));

      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const chunks: string[] = [];

      for await (const chunk of adapter.chat(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' ', 'World']);
      expect(createOpenAIClient).toHaveBeenCalledWith('test-api-key', undefined);
    });

    it('应传递正确的参数给 OpenAI API', async () => {
      mockCreate.mockResolvedValue(createMockStream(['ok']));

      const messages = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hi' },
      ];

      for await (const _ of adapter.chat(messages, { model: 'gpt-4', temperature: 0.7, maxTokens: 100 })) {
        // 消费生成器
      }

      expect(mockCreate).toHaveBeenCalledWith(
        {
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hi' },
          ],
          stream: true,
          temperature: 0.7,
          max_tokens: 100,
        },
        { signal: undefined },
      );
    });

    it('应使用默认模型（未指定时）', async () => {
      mockCreate.mockResolvedValue(createMockStream(['ok']));

      for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
        // 消费
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o-mini' }),
        expect.anything(),
      );
    });

    it('应跳过空 delta 的 chunk', async () => {
      mockCreate.mockResolvedValue(createMockStreamWithEmptyDelta());

      const chunks: string[] = [];
      for await (const chunk of adapter.chat([{ role: 'user', content: 'test' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['hello', ' world']);
    });

    it('应支持 AbortSignal 中断', async () => {
      const controller = new AbortController();

      // 创建一个会检查 signal 的流
      mockCreate.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'first' } }] };
          controller.abort(); // 模拟中断
          yield { choices: [{ delta: { content: 'second' } }] };
        },
      });

      const chunks: string[] = [];
      for await (const chunk of adapter.chat(
        [{ role: 'user', content: 'test' }],
        undefined,
        controller.signal,
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['first']);
    });

    it('应使用自定义 baseURL', async () => {
      const customAdapter = new OpenAIAdapter('key', 'https://deepseek.api.com/v1');
      mockCreate.mockResolvedValue(createMockStream(['ok']));

      for await (const _ of customAdapter.chat([{ role: 'user', content: 'test' }])) {
        // 消费
      }

      expect(createOpenAIClient).toHaveBeenCalledWith('key', 'https://deepseek.api.com/v1');
    });
  });

  describe('错误处理', () => {
    it('应处理 401 认证错误', async () => {
      const error = new Error('Unauthorized');
      (error as any).status = 401;
      mockCreate.mockRejectedValue(error);

      const collect = async () => {
        const chunks: string[] = [];
        for await (const chunk of adapter.chat([{ role: 'user', content: 'test' }])) {
          chunks.push(chunk);
        }
        return chunks;
      };

      await expect(collect()).rejects.toThrow('认证失败');
    });

    it('应处理 429 速率限制错误', async () => {
      const error = new Error('Rate limited');
      (error as any).status = 429;
      mockCreate.mockRejectedValue(error);

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('请求过于频繁');
    });

    it('应处理 404 模型不存在错误', async () => {
      const error = new Error('Model not found');
      (error as any).status = 404;
      mockCreate.mockRejectedValue(error);

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('模型不存在');
    });

    it('应处理 AbortError（用户中断）', async () => {
      const error = new DOMException('Aborted', 'AbortError');
      mockCreate.mockRejectedValue(error);

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow();
    });

    it('应处理通用错误', async () => {
      const error = new Error('Network failure');
      mockCreate.mockRejectedValue(error);

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('对话请求失败');
    });

    it('应处理带 statusCode 的错误', async () => {
      const error = new Error('Server error');
      (error as any).statusCode = 500;
      mockCreate.mockRejectedValue(error);

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('对话请求失败');
    });
  });
});
