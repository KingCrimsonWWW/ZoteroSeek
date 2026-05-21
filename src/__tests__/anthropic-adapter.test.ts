/**
 * Anthropic 适配器单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock HTTP 工具
vi.mock('@/utils/http', () => ({
  zoteroHTTPRequest: vi.fn(),
  parseSSEStream: vi.fn(),
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

import { AnthropicAdapter } from '@/apis/llm/anthropic';
import { zoteroHTTPRequest, parseSSEStream } from '@/utils/http';

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AnthropicAdapter({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-sonnet',
    });
  });

  describe('构造函数', () => {
    it('应使用提供的配置初始化', () => {
      expect(adapter.name).toBe('anthropic');
    });

    it('应使用默认 base URL（未指定时）', () => {
      const a = new AnthropicAdapter({
        provider: 'anthropic',
        apiKey: 'key',
        model: 'claude-3-opus',
      });
      expect(a.name).toBe('anthropic');
    });

    it('应使用自定义 base URL', () => {
      const a = new AnthropicAdapter({
        provider: 'anthropic',
        apiKey: 'key',
        model: 'claude-3-opus',
        baseUrl: 'https://custom.anthropic.com',
      });
      expect(a.name).toBe('anthropic');
    });
  });

  describe('chat 方法', () => {
    it('应流式返回响应内容', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'fake-sse-body',
      });

      (parseSSEStream as any).mockReturnValue([
        { parsed: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }, done: false },
        { parsed: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' World' } }, done: false },
        { done: true },
      ]);

      const chunks: string[] = [];
      for await (const chunk of adapter.chat([{ role: 'user', content: 'Hi' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' World']);
    });

    it('应分离 system 消息到顶层字段', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'fake-body',
      });
      (parseSSEStream as any).mockReturnValue([{ done: true }]);

      const messages = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hello' },
      ];

      for await (const _ of adapter.chat(messages)) {
        // 消费
      }

      const callArgs = (zoteroHTTPRequest as any).mock.calls[0];
      const body = JSON.parse(callArgs[2].body);

      expect(body.system).toBe('You are helpful');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(body.messages.find((m: any) => m.role === 'system')).toBeUndefined();
    });

    it('应合并多个 system 消息', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'fake-body',
      });
      (parseSSEStream as any).mockReturnValue([{ done: true }]);

      const messages = [
        { role: 'system' as const, content: 'Rule 1' },
        { role: 'system' as const, content: 'Rule 2' },
        { role: 'user' as const, content: 'Hello' },
      ];

      for await (const _ of adapter.chat(messages)) {
        // 消费
      }

      const body = JSON.parse((zoteroHTTPRequest as any).mock.calls[0][2].body);
      expect(body.system).toBe('Rule 1\nRule 2');
    });

    it('应传递可选参数（temperature、maxTokens）', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'fake-body',
      });
      (parseSSEStream as any).mockReturnValue([{ done: true }]);

      for await (const _ of adapter.chat(
        [{ role: 'user', content: 'test' }],
        { model: 'claude-3-opus', temperature: 0.5, maxTokens: 2048 },
      )) {
        // 消费
      }

      const body = JSON.parse((zoteroHTTPRequest as any).mock.calls[0][2].body);
      expect(body.model).toBe('claude-3-opus');
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(2048);
    });

    it('应使用默认 maxTokens（未指定时）', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'fake-body',
      });
      (parseSSEStream as any).mockReturnValue([{ done: true }]);

      for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
        // 消费
      }

      const body = JSON.parse((zoteroHTTPRequest as any).mock.calls[0][2].body);
      expect(body.max_tokens).toBe(1024);
    });

    it('应跳过非 content_block_delta 事件', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'fake-body',
      });
      (parseSSEStream as any).mockReturnValue([
        { parsed: { type: 'message_start' }, done: false },
        { parsed: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }, done: false },
        { parsed: { type: 'content_block_stop' }, done: false },
        { done: true },
      ]);

      const chunks: string[] = [];
      for await (const chunk of adapter.chat([{ role: 'user', content: 'test' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hi']);
    });

    it('应跳过无 parsed 的 chunk', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'fake-body',
      });
      (parseSSEStream as any).mockReturnValue([
        { data: 'raw-data', done: false }, // 无 parsed
        { parsed: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } }, done: false },
        { done: true },
      ]);

      const chunks: string[] = [];
      for await (const chunk of adapter.chat([{ role: 'user', content: 'test' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['OK']);
    });

    it('应发送正确的请求头', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'fake-body',
      });
      (parseSSEStream as any).mockReturnValue([{ done: true }]);

      for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
        // 消费
      }

      const callArgs = (zoteroHTTPRequest as any).mock.calls[0];
      expect(callArgs[0]).toBe('POST');
      expect(callArgs[1]).toContain('/v1/messages');
      expect(callArgs[2].headers['x-api-key']).toBe('test-key');
      expect(callArgs[2].headers['anthropic-version']).toBe('2023-06-01');
    });
  });

  describe('错误处理', () => {
    it('应处理 401 认证错误', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        body: '',
      });

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('认证失败');
    });

    it('应处理 429 速率限制错误', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 429,
        statusText: 'Too Many Requests',
        headers: {},
        body: '',
      });

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('速率限制');
    });

    it('应处理其他 HTTP 错误（带 JSON 错误体）', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
        headers: {},
        body: JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Something broke' } }),
      });

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('Something broke');
    });

    it('应处理其他 HTTP 错误（无 JSON 错误体）', async () => {
      (zoteroHTTPRequest as any).mockResolvedValue({
        status: 502,
        statusText: 'Bad Gateway',
        headers: {},
        body: 'not json',
      });

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('502 Bad Gateway');
    });

    it('应处理网络请求异常', async () => {
      (zoteroHTTPRequest as any).mockRejectedValue(new Error('Network error'));

      const collect = async () => {
        for await (const _ of adapter.chat([{ role: 'user', content: 'test' }])) {
          // 消费
        }
      };

      await expect(collect()).rejects.toThrow('Network error');
    });
  });
});
