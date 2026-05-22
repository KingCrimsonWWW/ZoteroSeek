/**
 * useChat Hook 单元测试
 *
 * 测试 useChat hook 的核心功能：消息发送、流式响应、错误处理、
 * 停止生成、清空消息、发送防抖。
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

// --- Store mocks（可变的测试状态） ---

let mockCurrentConfig = {
  provider: "openai" as const,
  apiKey: "test-api-key",
  model: "gpt-4",
};

const mockAddMessage = vi.fn().mockResolvedValue(undefined);
const mockClearMessages = vi.fn().mockResolvedValue(undefined);

const mockChatStoreState: {
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
  }[];
  currentConversationId: string | null;
  addMessage: ReturnType<typeof vi.fn>;
  clearMessages: ReturnType<typeof vi.fn>;
} = {
  messages: [],
  currentConversationId: "test-conv-id",
  addMessage: mockAddMessage,
  clearMessages: mockClearMessages,
};

vi.mock("@/stores/chatStore", () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof mockChatStoreState) => unknown) =>
      selector(mockChatStoreState),
    { getState: () => mockChatStoreState },
  ),
}));

vi.mock("@/stores/modelStore", () => ({
  useModelStore: (
    selector: (s: { currentConfig: typeof mockCurrentConfig }) => unknown,
  ) => selector({ currentConfig: mockCurrentConfig }),
}));

// --- LLM adapter mocks ---
// 用 class 表达式而非 vi.fn().mockImplementation() 确保 new 操作符正常工作
const mockChat = vi.fn();

vi.mock("@/apis/llm/openai", () => ({
  OpenAIAdapter: class {
    name = "openai";
    chat = mockChat;
  },
}));

vi.mock("@/apis/llm/anthropic", () => ({
  AnthropicAdapter: class {
    name = "anthropic";
    chat = mockChat;
  },
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

// =============================================================================
// Import after mocks
// =============================================================================

import { useChat } from "@/hooks/useChat";

// =============================================================================
// Tests
// =============================================================================

describe("useChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 重置 useState 追踪序列
    stateIndex = 0;
    stateValues.length = 0;
    stateSetters.length = 0;

    // 重置模型配置
    mockCurrentConfig = {
      provider: "openai",
      apiKey: "test-api-key",
      model: "gpt-4",
    };

    // 重置 store 状态
    mockChatStoreState.messages = [];
    mockChatStoreState.currentConversationId = "test-conv-id";

    // 模拟 navigator.onLine（Node 环境可能不存在）
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------

  describe("sendMessage", () => {
    it("应添加用户消息并流式返回助手回复", async () => {
      // Arrange: adapter 返回流式 tokens
      mockChat.mockReturnValue(createAsyncGenerator(["你好", "，", "世界"]));
      const hook = useChat();

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 添加了 user 消息
      expect(mockAddMessage).toHaveBeenCalledWith("user", "测试消息");

      // Assert: adapter.chat 被调用
      expect(mockChat).toHaveBeenCalled();

      // Assert: 添加了 assistant 消息（汇总后的完整内容）
      expect(mockAddMessage).toHaveBeenCalledWith("assistant", "你好，世界");

      // Assert: 加载状态变化（setIsLoading(true) → setIsLoading(false)）
      const setIsLoading = stateSetters[0];
      expect(setIsLoading).toHaveBeenCalledWith(true);
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it("API Key 为空时应显示错误消息", async () => {
      // Arrange: 空 API Key
      mockCurrentConfig.apiKey = "";
      const hook = useChat();

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 显示 API Key 错误消息
      expect(mockAddMessage).toHaveBeenCalledWith(
        "assistant",
        expect.stringContaining("API Key"),
        { isError: true },
      );

      // Assert: 未调用 LLM adapter
      expect(mockChat).not.toHaveBeenCalled();
    });

    it("网络断开时应显示网络错误", async () => {
      // Arrange: 模拟离线状态 + adapter 抛出错误
      (globalThis as any).navigator.onLine = false;
      mockChat.mockRejectedValue(new Error("Network failure"));
      const hook = useChat();

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
      mockChat.mockReturnValue(createAsyncGenerator(["回复"]));
      const hook = useChat();

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
  });

  // ---------------------------------------------------------------------------
  // stopGeneration
  // ---------------------------------------------------------------------------

  describe("stopGeneration", () => {
    it("应中断活跃流并重置状态", async () => {
      // Arrange
      const hook = useChat();

      // Act: 先发送消息（内部创建 AbortController），然后立即停止
      const sendPromise = hook.sendMessage("测试");
      hook.stopGeneration();
      await sendPromise;

      // Assert: 流式内容被重置为 null
      const setStreamingContent = stateSetters[1];
      expect(setStreamingContent).toHaveBeenCalledWith(null);

      // Assert: 加载状态最后为 false
      const setIsLoading = stateSetters[0];
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  // ---------------------------------------------------------------------------
  // clearMessages
  // ---------------------------------------------------------------------------

  describe("clearMessages", () => {
    it("应停止生成并清空消息", async () => {
      // Arrange
      const hook = useChat();

      // Act
      await hook.clearMessages();

      // Assert: 调用了 store 的 clearMessages
      expect(mockClearMessages).toHaveBeenCalled();

      // Assert: 触发了 stopGeneration（通过 setIsLoading(false) 间接验证）
      const setIsLoading = stateSetters[0];
      expect(setIsLoading).toHaveBeenCalledWith(false);
    });
  });
});
