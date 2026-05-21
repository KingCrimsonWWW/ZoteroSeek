/**
 * HTTP 工具模块
 * 提供 OpenAI 客户端创建、SSE 解析和 Zotero HTTP 备选方案
 */

/**
 * SSE 流式响应的数据块
 */
export interface SSEChunk {
  /** 原始数据内容 */
  data: string;
  /** 解析后的 JSON 对象（如果解析成功） */
  parsed?: Record<string, unknown>;
  /** 是否为流结束标记 */
  done: boolean;
}

/**
 * Zotero HTTP 请求选项
 */
export interface ZoteroHTTPRequestOptions {
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体（POST/PUT/PATCH） */
  body?: string | Uint8Array;
  /** 响应类型 */
  responseType?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 测试 openai 包在当前环境中是否可用
 * @returns 如果 openai 包可用返回 true，否则返回 false
 */
export async function testOpenAIPackage(): Promise<boolean> {
  try {
    // 尝试动态导入 openai 包
    const openai = await import("openai");
    // 验证 OpenAI 类是否存在
    if (openai && openai.default) {
      ztoolkit.log("[http] openai 包可用");
      return true;
    }
    ztoolkit.log("[http] openai 包导入成功但缺少默认导出");
    return false;
  } catch (error) {
    ztoolkit.log("[http] openai 包不可用:", error);
    return false;
  }
}

/**
 * 创建 OpenAI 客户端
 * @param apiKey - API 密钥
 * @param baseURL - 可选的基础 URL（用于 DeepSeek、MiMo 等兼容 API）
 * @returns OpenAI 客户端实例
 */
export async function createOpenAIClient(
  apiKey: string,
  baseURL?: string,
) {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey,
    ...(baseURL && { baseURL }),
    dangerouslyAllowBrowser: false,
  });
  return client;
}

/**
 * 使用 Zotero.HTTP.request 发送 HTTP 请求（备选方案）
 * 当 openai 包不可用时使用
 * @param method - HTTP 方法
 * @param url - 请求 URL
 * @param options - 请求选项
 * @returns 响应数据
 */
export async function zoteroHTTPRequest(
  method: string,
  url: string,
  options: ZoteroHTTPRequestOptions = {},
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}> {
  const { headers = {}, body, responseType, timeout } = options;

  const requestOptions: Record<string, unknown> = {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body && { body }),
    ...(responseType && { responseType }),
    ...(timeout && { timeout }),
  };

  try {
    const response = await Zotero.HTTP.request(method, url, requestOptions);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers || {},
      body: response.body || "",
    };
  } catch (error: unknown) {
    const err = error as Error;
    ztoolkit.log("[http] Zotero HTTP 请求失败:", err.message);
    const newError = new Error(`Zotero HTTP 请求失败: ${err.message}`);
    (newError as any).cause = error;
    throw newError;
  }
}

/**
 * 解析 SSE（Server-Sent Events）流式响应
 * 格式: data: {...}\n\n
 * @param response - 响应对象或响应文本
 * @returns 解析后的 SSE 数据块数组
 */
export function parseSSEStream(
  response: string | { body: string },
): SSEChunk[] {
  const text = typeof response === "string" ? response : response.body;
  const chunks: SSEChunk[] = [];

  // 按双换行符分割事件
  const events = text.split("\n\n").filter((event) => event.trim());

  for (const event of events) {
    const lines = event.split("\n");
    let data = "";

    for (const line of lines) {
      const trimmedLine = line.trim();

      // 跳过空行和注释
      if (!trimmedLine || trimmedLine.startsWith(":")) {
        continue;
      }

      // 处理 data: 前缀
      if (trimmedLine.startsWith("data: ")) {
        data = trimmedLine.slice(6);
      } else if (trimmedLine === "data:") {
        // 空 data 字段
        data = "";
      } else if (trimmedLine === "[DONE]") {
        // 流结束标记
        chunks.push({ data: "[DONE]", done: true });
        continue;
      }
    }

    if (data) {
      const chunk: SSEChunk = {
        data,
        done: data === "[DONE]",
      };

      // 尝试解析 JSON
      try {
        chunk.parsed = JSON.parse(data);
      } catch {
        // 非 JSON 数据，保持原始字符串
      }

      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * 使用 Zotero.HTTP 发送流式请求并解析 SSE
 * 注意：Zotero.HTTP.request 可能不支持真正的流式传输，
 * 此函数会等待完整响应后解析
 * @param method - HTTP 方法（通常是 POST）
 * @param url - 请求 URL
 * @param body - 请求体
 * @param headers - 请求头
 * @returns 解析后的 SSE 数据块数组
 */
export async function fetchAndParseSSE(
  method: string,
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<SSEChunk[]> {
  const response = await zoteroHTTPRequest(method, url, {
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return parseSSEStream(response);
}
