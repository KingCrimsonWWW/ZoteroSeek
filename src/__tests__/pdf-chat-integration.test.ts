/**
 * PDF 对话集成测试
 *
 * 测试 useChatBase（pdf 模式）的核心功能（跨窗口 PDF 对话）：
 * 消息发送、流式响应、停止生成，以及 PDF 文本提取。
 *
 * useChatBase pdf 模式与 chat 模式的关键区别：
 * - 使用 pdfConversationId 而非 currentConversationId
 * - 直接读写 Dexie（chatDb 实例）
 * - 管理本地 messages 状态而非通过 store.addMessage
 */

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

// Chat store state — 可被 beforeEach 重置
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

// 内存数据库 — 模拟 Dexie/IndexedDB 的 CRUD 行为
const mockConversationsDb: Map<string, any> = new Map();

vi.mock("@/stores/chatStore", () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof mockChatStoreState) => unknown) =>
      selector(mockChatStoreState),
    { getState: () => mockChatStoreState },
  ),
  chatDb: {
    conversations: {
      get: vi.fn(async (id: string) => mockConversationsDb.get(id)),
      add: vi.fn(async (conv: any) => {
        mockConversationsDb.set(conv.id, conv);
      }),
      update: vi.fn(async (id: string, updates: any) => {
        const existing = mockConversationsDb.get(id);
        if (existing) {
          mockConversationsDb.set(id, { ...existing, ...updates });
        }
      }),
    },
  },
}));

vi.mock("@/stores/modelStore", () => ({
  useModelStore: (
    selector: (s: { currentConfig: typeof mockCurrentConfig }) => unknown,
  ) => selector({ currentConfig: mockCurrentConfig }),
}));

// --- LLM adapter mocks（class 表达式确保 new 操作符正常） ---
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

// --- pdfjs-dist mock（用于 extractText 测试） ---
let mockLoadingTask: { promise: Promise<any> } | undefined;
const mockGetDocument = vi.fn(() => mockLoadingTask);

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: mockGetDocument,
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

import { useChatBase } from "@/hooks/useChatBase";
import { extractText } from "@/services/pdf/extractor";
import { chatDb } from "@/stores/chatStore";

// =============================================================================
// Tests
// =============================================================================

describe("useChatBase pdf 模式 — PDF 对话集成测试", () => {
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
    mockChatStoreState.pdfConversationId = null;

    // 清空内存数据库
    mockConversationsDb.clear();

    // 模拟 navigator.onLine
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
    it("应创建 PDF 对话并流式返回助手回复", async () => {
      // Arrange: adapter 返回流式 tokens
      mockChat.mockReturnValue(createAsyncGenerator(["你好", "，", "世界"]));
      const hook = useChatBase({ mode: "pdf" });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 创建了新对话
      expect(chatDb.conversations.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "PDF 对话",
          messages: [],
        }),
      );

      // Assert: 设置 PDF 对话 ID
      expect(mockChatStoreState.setPdfConversationId).toHaveBeenCalled();

      // Assert: 刷新对话列表
      expect(mockChatStoreState.listConversations).toHaveBeenCalled();

      // Assert: adapter.chat 被调用
      expect(mockChat).toHaveBeenCalled();

      // Assert: 用户消息已持久化
      expect(chatDb.conversations.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "测试消息" }),
          ]),
        }),
      );

      // Assert: 助手回复已持久化（完整内容）
      expect(chatDb.conversations.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "assistant", content: "你好，世界" }),
          ]),
        }),
      );

      // Assert: 加载状态变化（setIsLoading(true) → setIsLoading(false)）
      // useChatBase pdf 模式 useState 索引: [pdfMessages(0), isLoading(1), streamingContent(2), error(3)]
      const setIsLoading = stateSetters[1];
      expect(setIsLoading).toHaveBeenCalledWith(true);
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it("API Key 为空时应显示错误消息且不调用 LLM", async () => {
      // Arrange: 空 API Key
      mockCurrentConfig.apiKey = "";
      const hook = useChatBase({ mode: "pdf" });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: setMessages 被传入 updater function（而非直接数组）
      // sendMessage 在检测到空 API Key 时调用 setMessages((prev) => [...prev, errorMsg])
      const setMessages = stateSetters[0];
      expect(setMessages).toHaveBeenCalledWith(expect.any(Function));

      // Assert: stateValues 中包含错误消息
      expect(stateValues[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.stringContaining("API Key"),
          }),
        ]),
      );

      // Assert: 未调用 LLM adapter
      expect(mockChat).not.toHaveBeenCalled();

      // Assert: 没有持久化对话（未调用 add）
      expect(chatDb.conversations.add).not.toHaveBeenCalled();
    });

    it("网络断开时应显示网络错误消息", async () => {
      // Arrange: 模拟离线状态 + adapter 抛出错误
      (globalThis as any).navigator.onLine = false;
      mockChat.mockRejectedValue(new Error("Network failure"));
      const hook = useChatBase({ mode: "pdf" });

      // Act
      await hook.sendMessage("测试消息");

      // Assert: 显示网络断开错误
      const setMessages = stateSetters[0];
      expect(setMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.stringContaining("网络"),
            metadata: { isError: true },
          }),
        ]),
      );

      // Assert: adapter.chat 被调用（但抛出了错误）
      expect(mockChat).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // stopGeneration
  // ---------------------------------------------------------------------------

  describe("stopGeneration", () => {
    it("应中断活跃流并重置加载状态", async () => {
      // Arrange
      mockChat.mockReturnValue(createAsyncGenerator(["回复"]));
      const hook = useChatBase({ mode: "pdf" });

      // Act: 先发送消息（内部创建 AbortController），然后立即停止
      const sendPromise = hook.sendMessage("测试");
      hook.stopGeneration();
      await sendPromise;

      // Assert: 流式内容被重置为 null
      // useChatBase pdf 模式 useState 索引: [pdfMessages(0), isLoading(1), streamingContent(2), error(3)]
      const setStreamingContent = stateSetters[2];
      expect(setStreamingContent).toHaveBeenCalledWith(null);

      // Assert: 加载状态最后为 false
      const setIsLoading = stateSetters[1];
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  // ---------------------------------------------------------------------------
  // setPdfConversationId
  // ---------------------------------------------------------------------------
  //
  // 注意：useEffect 的 mock 仅在 hook 创建时执行一次，不会因依赖变化重新运行。
  // 因此以下测试仅验证 store action 的调用，不测试 effect 的消息加载行为。

  describe("setPdfConversationId", () => {
    it("应更新 store 中的 pdfConversationId", () => {
      const hook = useChatBase({ mode: "pdf" });

      hook.setPdfConversationId!("test-pdf-id");

      expect(mockChatStoreState.setPdfConversationId).toHaveBeenCalledWith(
        "test-pdf-id",
      );
      expect(mockChatStoreState.pdfConversationId).toBe("test-pdf-id");
    });

    it("设置为 null 时应更新 store", () => {
      // Arrange: 先设置为一个值
      mockChatStoreState.pdfConversationId = "some-id";
      const hook = useChatBase({ mode: "pdf" });
      vi.clearAllMocks();

      // Act
      hook.setPdfConversationId!(null);

      // Assert
      expect(mockChatStoreState.setPdfConversationId).toHaveBeenCalledWith(null);
      expect(mockChatStoreState.pdfConversationId).toBeNull();
    });

    it("从 hook 返回的 setPdfConversationId 即是 store action", () => {
      const hook = useChatBase({ mode: "pdf" });

      // hook.setPdfConversationId 应该引用 store 的 setPdfConversationId
      expect(hook.setPdfConversationId).toBe(
        mockChatStoreState.setPdfConversationId,
      );
    });
  });
});

// =============================================================================
// PDF 文本提取测试
// =============================================================================

describe("extractText — PDF 文本提取", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 设置 pdfjs-dist mock 的默认实现
    const mockPage1 = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: "第一页" }, { str: "内容" }],
      }),
    };
    const mockPage2 = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: "第二页" }, { str: "文本" }],
      }),
    };

    mockLoadingTask = {
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn()
          .mockResolvedValueOnce(mockPage1)
          .mockResolvedValueOnce(mockPage2),
        getMetadata: vi.fn().mockResolvedValue({
          info: {
            Title: "测试文档",
            Author: "测试作者",
            Subject: "测试主题",
          },
        }),
      }),
    };
  });

  it("应提取多页 PDF 文本并返回完整结构", async () => {
    // Act
    const result = await extractText("/fake/document.pdf");

    // Assert: 结构完整性
    expect(result).toHaveProperty("fullText");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("metadata");

    // Assert: 页码
    expect(result.pageCount).toBe(2);

    // Assert: 提取的文本内容
    expect(result.fullText).toContain("第一页");
    expect(result.fullText).toContain("第二页");
    expect(result.fullText).toContain("内容");

    // Assert: 元数据
    expect(result.metadata.title).toBe("测试文档");
    expect(result.metadata.author).toBe("测试作者");
    expect(result.metadata.subject).toBe("测试主题");

    // Assert: pdfjs-dist API 被正确调用
    expect(mockGetDocument).toHaveBeenCalledWith("/fake/document.pdf");
  });

  it("应处理单页 PDF", async () => {
    // Arrange: 单页 PDF
    const singlePage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: "仅有一页" }],
      }),
    };
    mockLoadingTask = {
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(singlePage),
        getMetadata: vi.fn().mockResolvedValue({
          info: {},
        }),
      }),
    };

    // Act
    const result = await extractText("/fake/single.pdf");

    // Assert
    expect(result.pageCount).toBe(1);
    expect(result.fullText).toBe("仅有一页");

    // 元数据为空对象时应返回 undefined
    expect(result.metadata.title).toBeUndefined();
  });

  it("空白 PDF 应返回空字符串", async () => {
    // Arrange: 空白页
    const emptyPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [],
      }),
    };
    mockLoadingTask = {
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(emptyPage),
        getMetadata: vi.fn().mockResolvedValue({
          info: {},
        }),
      }),
    };

    // Act
    const result = await extractText("/fake/empty.pdf");

    // Assert
    expect(result.pageCount).toBe(1);
    expect(result.fullText).toBe("");
  });
});
