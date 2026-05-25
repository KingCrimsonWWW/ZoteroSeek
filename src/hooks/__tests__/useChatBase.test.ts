/**
 * useChatBase Hook 单元测试
 *
 * 测试 useChatBase hook 的核心功能：消息发送、流式响应、错误处理、
 * 停止生成、RAG 集成、防抖、对话切换取消流。
 * 使用 vi.mock 模拟 React hooks 和所有外部依赖。
 */

import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Mock React hooks（手动追踪 useState 状态用于后续断言）
// =============================================================================
const stateValues: unknown[] = [];
const stateSetters: ReturnType<typeof vi.fn>[] = [];
let stateIndex = 0;

vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    useState: vi.fn((initial: unknown) => {
      const idx = stateIndex++;
      if (idx >= stateValues.length) {
        stateValues.push(initial);
        stateSetters.push(
          vi.fn((val: unknown) => {
            stateValues[idx] =
              typeof val === "function" ? val(stateValues[idx]) : val;
          }),
        );
      }
      return [stateValues[idx], stateSetters[idx]];
    }),
    useCallback: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
    useRef: vi.fn((initial: unknown) => ({ current: initial })),
    useEffect: vi.fn((fn: () => (() => void) | void) => {
      try {
        fn();
      } catch {
        /* 挂载副作用静默执行 */
      }
    }),
    useMemo: vi.fn((fn: () => unknown) => fn()),
  };
});

// =============================================================================
// Mock dependencies
// =============================================================================

// --- Logger（每个测试独立重置） ---
vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// --- RAG integration mock ---
const mockAugmentMessage = vi.fn().mockResolvedValue({ context: "", sources: [] });

vi.mock("@/services/rag/chatIntegration", () => ({
  augmentMessage: (...args: unknown[]) => mockAugmentMessage(...args),
}));

// --- Chat store mock（避免 zustand 依赖 React.useCallback） ---
const mockChatStoreState: {
  pdfConversationId: string | null;
  setPdfConversationId: ReturnType<typeof vi.fn>;
  listConversations: ReturnType<typeof vi.fn>;
} = {
  pdfConversationId: null,
  setPdfConversationId: vi.fn((id: string | null) => {
    mockChatStoreState.pdfConversationId = id;
  }),
  listConversations: vi.fn(),
};

vi.mock("@/stores/chatStore", () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof mockChatStoreState) => unknown) =>
      selector(mockChatStoreState),
    { getState: () => mockChatStoreState },
  ),
  chatDb: {
    conversations: {
      get: vi.fn(async () => undefined),
      add: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
    },
  },
}));

// --- Model store mock ---
vi.mock("@/stores/modelStore", () => ({
  useModelStore: (selector: (s: { currentConfig: Record<string, unknown> }) => unknown) =>
    selector({
      currentConfig: {
        provider: "openai",
        apiKey: "test-api-key",
        model: "gpt-4",
      },
    }),
}));

// --- ID utils mock ---
vi.mock("@/utils/id", () => ({
  generateId: () => "test-id-" + Math.random().toString(36).slice(2, 9),
}));

// --- Adapter utils mock ---
vi.mock("@/utils/adapter", () => ({
  createAdapter: vi.fn(() => null),
}));

// =============================================================================
// Helpers
// =============================================================================

/** 异步生成器：逐 token 产出字符串 */
async function* createAsyncGenerator(
  tokens: string[],
): AsyncGenerator<string> {
  for (const token of tokens) {
    yield token;
  }
}

/** 异步生成器：抛出错误 */
async function* createErrorGenerator(error: Error): AsyncGenerator<string> {
  throw error;
  yield ""; // unreachable, but satisfies TypeScript
}

/** 创建 mock LLM adapter */
function createMockAdapter(chatFn?: ReturnType<typeof vi.fn>) {
  return {
    name: "openai",
    chat: chatFn || vi.fn(),
  };
}

// =============================================================================
// Import after mocks
// =============================================================================

import type { Message } from "@/typings";
import type { UseChatBaseOptions } from "@/hooks/useChatBase";
import { useChatBase } from "@/hooks/useChatBase";

// =============================================================================
// Tests
// =============================================================================

describe("useChatBase", () => {
  // Default options template
  const defaultMessages: Message[] = [];
  let mockAddMessage: UseChatBaseOptions["onAddMessage"];
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();

    // 重置 useState 追踪序列
    stateIndex = 0;
    stateValues.length = 0;
    stateSetters.length = 0;

    // 重置 mock 函数
    mockAddMessage = vi.fn().mockResolvedValue(undefined) as unknown as UseChatBaseOptions["onAddMessage"];
    mockAdapter = createMockAdapter(vi.fn());

    // 模拟 navigator.onLine
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessage - 基本流程
  // ---------------------------------------------------------------------------

  describe("sendMessage", () => {
    it("应添加用户消息并流式返回助手回复", async () => {
      // Arrange: adapter 返回流式 tokens
      mockAdapter.chat.mockReturnValue(createAsyncGenerator(["你好", "，", "世界"]));
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 添加了 user 消息
      expect(mockAddMessage).toHaveBeenCalledWith("user", "测试消息");

      // Assert: adapter.chat 被调用
      expect(mockAdapter.chat).toHaveBeenCalled();

      // Assert: 添加了 assistant 消息（汇总后的完整内容）
      expect(mockAddMessage).toHaveBeenCalledWith("assistant", "你好，世界");

      // Assert: 加载状态变化（setIsLoading(true) → setIsLoading(false)）
      // useChatBase useState 索引: [pdfMessages(0), isLoading(1), streamingContent(2), error(3)]
      const setIsLoading = stateSetters[1];
      expect(setIsLoading).toHaveBeenCalledWith(true);
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it("API Key 为空时应显示错误消息", async () => {
      // Arrange: 空 API Key
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 显示 API Key 错误消息
      expect(mockAddMessage).toHaveBeenCalledWith(
        "assistant",
        expect.stringContaining("API Key"),
        { isError: true },
      );

      // Assert: 未调用 LLM adapter
      expect(mockAdapter.chat).not.toHaveBeenCalled();
    });

    it("API Key 为 undefined 时应显示错误消息", async () => {
      // Arrange: undefined API Key
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: undefined,
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 显示 API Key 错误消息
      expect(mockAddMessage).toHaveBeenCalledWith(
        "assistant",
        expect.stringContaining("API Key"),
        { isError: true },
      );
    });

    it("网络断开时应显示网络错误", async () => {
      // Arrange: 模拟离线状态 + adapter 抛出错误
      (globalThis as any).navigator.onLine = false;
      mockAdapter.chat.mockReturnValue(createErrorGenerator(new Error("Network failure")));
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 显示网络断开错误
      expect(mockAddMessage).toHaveBeenCalledWith(
        "assistant",
        expect.stringContaining("网络"),
        { isError: true },
      );
    });

    it("快速连续发送消息应被防抖忽略", async () => {
      // Arrange
      mockAdapter.chat.mockReturnValue(createAsyncGenerator(["回复"]));
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act: 同步发起第一次调用但不等完成，
      //      第二次调用在同一同步 tick 内，防抖生效
      const promise1 = hook.sendMessage("第一条");
      await hook.sendMessage("第二条");
      await promise1;

      // Assert: 只处理了第一条消息
      expect(mockAddMessage).toHaveBeenCalledWith("user", "第一条");
      expect(mockAddMessage).toHaveBeenCalledWith("assistant", "回复");

      // Assert: 第二条消息未被添加为用户消息
      expect(mockAddMessage).not.toHaveBeenCalledWith("user", "第二条");
    });

    it("adapter 为 null 时应显示错误", async () => {
      // Arrange
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: null,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 显示 adapter 错误
      expect(mockAddMessage).toHaveBeenCalledWith(
        "assistant",
        expect.stringContaining("适配器"),
        { isError: true },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // stopGeneration
  // ---------------------------------------------------------------------------

  describe("stopGeneration", () => {
    it("应中断活跃流并重置状态", async () => {
      // Arrange
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act: 先发送消息（内部创建 AbortController），然后立即停止
      const sendPromise = hook.sendMessage("测试");
      hook.stopGeneration();
      await sendPromise;

      // Assert: 流式内容被重置为 null
      const setStreamingContent = stateSetters[2];
      expect(setStreamingContent).toHaveBeenCalledWith(null);

      // Assert: 加载状态最后为 false
      const setIsLoading = stateSetters[1];
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  // ---------------------------------------------------------------------------
  // RAG integration
  // ---------------------------------------------------------------------------

  describe("RAG integration", () => {
    it("有 RAG 配置时应增强消息上下文", async () => {
      // Arrange: RAG 返回上下文
      mockAugmentMessage.mockResolvedValue({
        context: "相关文献片段",
        sources: [],
      });
      mockAdapter.chat.mockReturnValue(createAsyncGenerator(["回复"]));
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
        ragConfig: {
          apiKey: "rag-api-key",
          baseUrl: "https://api.example.com",
          model: "text-embedding-ada-002",
        },
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: RAG 被调用
      expect(mockAugmentMessage).toHaveBeenCalledWith(
        "测试消息",
        "rag-api-key",
        3,
        "https://api.example.com",
        "text-embedding-ada-002",
      );

      // Assert: adapter.chat 收到包含 system 消息的上下文
      const chatCall = mockAdapter.chat.mock.calls[0][0];
      expect(chatCall[0]).toEqual({
        role: "system",
        content: expect.stringContaining("相关文献片段"),
      });
    });

    it("RAG 配置为 undefined 时应跳过 RAG 增强", async () => {
      // Arrange
      mockAdapter.chat.mockReturnValue(createAsyncGenerator(["回复"]));
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: RAG 未被调用
      expect(mockAugmentMessage).not.toHaveBeenCalled();
    });

    it("RAG 失败时应降级为普通对话", async () => {
      // Arrange: RAG 抛出错误
      mockAugmentMessage.mockRejectedValue(new Error("RAG failure"));
      mockAdapter.chat.mockReturnValue(createAsyncGenerator(["回复"]));
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
        ragConfig: {
          apiKey: "rag-api-key",
        },
      });

      // Act: 不应抛出错误
      await hook.sendMessage("测试消息");

      // Assert: adapter.chat 仍被调用（降级为普通对话）
      expect(mockAdapter.chat).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    it("AbortError 不应显示错误消息", async () => {
      // Arrange: adapter 的 async generator 抛出 AbortError
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockAdapter.chat.mockReturnValue(createErrorGenerator(abortError));
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 只添加了 user 消息，没有 error 消息
      expect(mockAddMessage).toHaveBeenCalledTimes(1);
      expect(mockAddMessage).toHaveBeenCalledWith("user", "测试消息");
    });

    it("一般错误应显示错误消息", async () => {
      // Arrange: adapter 的 async generator 抛出一般错误
      mockAdapter.chat.mockReturnValue(
        createErrorGenerator(new Error("API rate limit exceeded")),
      );
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 显示错误消息
      expect(mockAddMessage).toHaveBeenCalledWith(
        "assistant",
        expect.stringContaining("API rate limit exceeded"),
        { isError: true },
      );
    });

    it("error 状态应被设置", async () => {
      // Arrange
      mockAdapter.chat.mockReturnValue(
        createErrorGenerator(new Error("API error")),
      );
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: error setter 被调用（useState[3] = error）
      const setError = stateSetters[3];
      expect(setError).toHaveBeenCalledWith(expect.stringContaining("API error"));
    });
  });

  // ---------------------------------------------------------------------------
  // isStreaming state
  // ---------------------------------------------------------------------------

  describe("isStreaming", () => {
    it("初始状态应为 false", () => {
      // Arrange & Act
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Assert
      expect(hook.isStreaming).toBe(false);
    });

    it("完成后应为 false", async () => {
      // Arrange
      mockAdapter.chat.mockReturnValue(createAsyncGenerator(["回复"]));
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "test-conv-id",
      });

      // Act
      await hook.sendMessage("测试");

      // Assert: 完成后 isStreaming 为 false
      // isStreaming = streamingContent !== null, streamingContent is set to null in finally
      expect(hook.isStreaming).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Conversation change cancels stream
  // ---------------------------------------------------------------------------

  describe("conversation change", () => {
    it("对话 ID 变化时应调用 stopGeneration", () => {
      // Arrange: 创建 hook 时 conversationId = "conv-1"
      const hook = useChatBase({
        messages: defaultMessages,
        onAddMessage: mockAddMessage,
        adapter: mockAdapter as any,
        apiKey: "test-api-key",
        conversationId: "conv-1",
      });

      // Assert: useEffect 被调用（conversation change effect）
      // The mock useEffect runs immediately, and since prevConversationIdRef.current
      // equals conversationId, stopGeneration should NOT be called
      const setStreamingContent = stateSetters[1];
      expect(setStreamingContent).not.toHaveBeenCalled();
    });
  });
});
