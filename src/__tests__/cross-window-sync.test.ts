/**
 * 跨窗口状态同步测试
 *
 * 测试 chatStore 在主窗口和 PDF 窗口之间的状态同步：
 * - 两个窗口独立维护各自的对话 ID（currentConversationId / pdfConversationId）
 * - BroadcastChannel 模拟跨窗口消息通信
 * - 对话切换不会互相干扰
 * - 并发消息操作的正确性
 *
 * Zotero 插件中，主窗口和 PDF 窗口共享同一 JS 运行时（chrome context），
 * 因此 Zustand store 是模块级单例，两个窗口天然共享同一 store 实例。
 */

import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock db client（Worker 不可用，走内存降级路径）
vi.mock("@/db/client", () => ({
  getConversations: vi.fn().mockRejectedValue(new Error("Worker not available")),
  getConversation: vi.fn().mockRejectedValue(new Error("Worker not available")),
  upsertConversation: vi.fn().mockRejectedValue(new Error("Worker not available")),
  deleteConversation: vi.fn().mockRejectedValue(new Error("Worker not available")),
  upsertMessage: vi.fn().mockRejectedValue(new Error("Worker not available")),
  getMessages: vi.fn().mockRejectedValue(new Error("Worker not available")),
  clearMessagesForConversation: vi.fn().mockRejectedValue(new Error("Worker not available")),
}));

import { useChatStore, clearMemoryStore } from "@/stores/chatStore";
import type { Message } from "@/typings";

// =============================================================================
// BroadcastChannel Mock
// =============================================================================

interface BroadcastMessage {
  type: string;
  payload: unknown;
}

/** 简易 BroadcastChannel mock，支持跨 "窗口" 消息传递 */
class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>();

  name: string;
  private listeners: Array<(event: { data: BroadcastMessage }) => void> = [];

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set());
    }
    MockBroadcastChannel.channels.get(name)!.add(this);
  }

  postMessage(data: BroadcastMessage) {
    const peers = MockBroadcastChannel.channels.get(this.name);
    if (peers) {
      for (const peer of peers) {
        if (peer !== this) {
          for (const listener of peer.listeners) {
            listener({ data });
          }
        }
      }
    }
  }

  addEventListener(_type: string, handler: (event: { data: BroadcastMessage }) => void) {
    this.listeners.push(handler);
  }

  removeEventListener(_type: string, handler: (event: { data: BroadcastMessage }) => void) {
    this.listeners = this.listeners.filter((l) => l !== handler);
  }

  close() {
    const peers = MockBroadcastChannel.channels.get(this.name);
    if (peers) {
      peers.delete(this);
      if (peers.size === 0) {
        MockBroadcastChannel.channels.delete(this.name);
      }
    }
    this.listeners = [];
  }

  static reset() {
    MockBroadcastChannel.channels.clear();
  }
}

// =============================================================================
// Cross-Window Sync Manager（模拟 pdfChatWindow 的同步逻辑）
// =============================================================================

/**
 * 模拟跨窗口同步管理器
 * 在真实 Zotero 环境中，pdfChatWindow.ts 使用 BroadcastChannel 同步状态
 */
class CrossWindowSyncManager {
  private channel: MockBroadcastChannel;
  private windowId: string;
  private onMessage: (msg: BroadcastMessage) => void;

  constructor(windowId: string, channelName: string, onMessage: (msg: BroadcastMessage) => void) {
    this.windowId = windowId;
    this.channel = new MockBroadcastChannel(channelName);
    this.onMessage = onMessage;

    this.channel.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });
  }

  send(type: string, payload: unknown) {
    this.channel.postMessage({ type, payload });
  }

  close() {
    this.channel.close();
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("跨窗口状态同步", () => {
  beforeEach(() => {
    clearMemoryStore();
    MockBroadcastChannel.reset();

    useChatStore.setState({
      currentConversationId: null,
      pdfConversationId: null,
      messages: [],
      conversations: [],
      isLoading: false,
    });
  });

  afterEach(() => {
    MockBroadcastChannel.reset();
  });

  // ---------------------------------------------------------------------------
  // Store 状态隔离
  // ---------------------------------------------------------------------------

  describe("store 状态隔离", () => {
    it("主窗口和 PDF 窗口应各自维护独立的对话 ID", async () => {
      // 主窗口创建对话
      const mainConvId = await useChatStore.getState().addConversation("主窗口对话");
      expect(useChatStore.getState().currentConversationId).toBe(mainConvId);
      expect(useChatStore.getState().pdfConversationId).toBeNull();

      // 设置 PDF 窗口对话 ID
      useChatStore.getState().setPdfConversationId("pdf-conv-1");
      expect(useChatStore.getState().currentConversationId).toBe(mainConvId);
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-conv-1");
    });

    it("设置 PDF 对话 ID 不应影响主窗口对话", async () => {
      const mainConvId = await useChatStore.getState().addConversation("主窗口");

      // 多次设置 PDF 对话 ID
      useChatStore.getState().setPdfConversationId("pdf-1");
      useChatStore.getState().setPdfConversationId("pdf-2");
      useChatStore.getState().setPdfConversationId("pdf-3");

      expect(useChatStore.getState().currentConversationId).toBe(mainConvId);
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-3");
    });

    it("切换主窗口对话不应影响 PDF 对话 ID", async () => {
      useChatStore.getState().setPdfConversationId("pdf-persistent");

      const conv1 = await useChatStore.getState().addConversation("对话1");
      await new Promise((r) => setTimeout(r, 10));
      const conv2 = await useChatStore.getState().addConversation("对话2");

      expect(useChatStore.getState().currentConversationId).toBe(conv2);
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-persistent");

      // 切换回对话1
      await useChatStore.getState().setCurrentConversation(conv1);
      expect(useChatStore.getState().currentConversationId).toBe(conv1);
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-persistent");
    });

    it("清除 PDF 对话 ID 不应影响主窗口", async () => {
      const mainConvId = await useChatStore.getState().addConversation("主窗口");
      useChatStore.getState().setPdfConversationId("pdf-to-clear");

      useChatStore.getState().setPdfConversationId(null);

      expect(useChatStore.getState().currentConversationId).toBe(mainConvId);
      expect(useChatStore.getState().pdfConversationId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // BroadcastChannel 跨窗口通信
  // ---------------------------------------------------------------------------

  describe("BroadcastChannel 跨窗口通信", () => {
    it("主窗口发送消息应被 PDF 窗口接收", () => {
      const received: BroadcastMessage[] = [];

      const mainWindow = new CrossWindowSyncManager("main", "zotero-seek-sync", (msg) => {
        // 主窗口不应收到自己发的消息
      });

      const _pdfWindow = new CrossWindowSyncManager("pdf", "zotero-seek-sync", (msg) => {
        received.push(msg);
      });

      mainWindow.send("conversation-changed", { id: "conv-1" });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        type: "conversation-changed",
        payload: { id: "conv-1" },
      });

      mainWindow.close();
      _pdfWindow.close();
    });

    it("PDF 窗口发送消息应被主窗口接收", () => {
      const received: BroadcastMessage[] = [];

      const mainWindow = new CrossWindowSyncManager("main", "zotero-seek-sync", (msg) => {
        received.push(msg);
      });

      const _pdfWindow = new CrossWindowSyncManager("pdf", "zotero-seek-sync", (msg) => {
        // PDF 窗口不应收到自己发的消息
      });

      _pdfWindow.send("pdf-closed", { conversationId: "pdf-conv-1" });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        type: "pdf-closed",
        payload: { conversationId: "pdf-conv-1" },
      });

      mainWindow.close();
      _pdfWindow.close();
    });

    it("双向通信：主窗口和 PDF 窗口可互相发送消息", () => {
      const mainReceived: BroadcastMessage[] = [];
      const pdfReceived: BroadcastMessage[] = [];

      const mainWindow = new CrossWindowSyncManager("main", "zotero-seek-sync", (msg) => {
        mainReceived.push(msg);
      });

      const _pdfWindow = new CrossWindowSyncManager("pdf", "zotero-seek-sync", (msg) => {
        pdfReceived.push(msg);
      });

      // 主窗口 → PDF 窗口
      mainWindow.send("conversation-changed", { id: "main-conv" });
      // PDF 窗口 → 主窗口
      _pdfWindow.send("pdf-ready", { conversationId: "pdf-conv" });

      expect(mainReceived).toHaveLength(1);
      expect(mainReceived[0].type).toBe("pdf-ready");

      expect(pdfReceived).toHaveLength(1);
      expect(pdfReceived[0].type).toBe("conversation-changed");

      mainWindow.close();
      _pdfWindow.close();
    });

    it("关闭通道后不应再接收消息", () => {
      const received: BroadcastMessage[] = [];

      const mainWindow = new CrossWindowSyncManager("main", "zotero-seek-sync", () => {});
      const _pdfWindow = new CrossWindowSyncManager("pdf", "zotero-seek-sync", (msg) => {
        received.push(msg);
      });

      // 关闭 PDF 窗口通道
      _pdfWindow.close();

      // 主窗口发送消息
      mainWindow.send("test", { data: "should not be received" });

      expect(received).toHaveLength(0);

      mainWindow.close();
    });

    it("多个接收者应独立接收消息", () => {
      const received1: BroadcastMessage[] = [];
      const received2: BroadcastMessage[] = [];

      const sender = new CrossWindowSyncManager("sender", "channel", () => {});
      const _receiver1 = new CrossWindowSyncManager("r1", "channel", (msg) => {
        received1.push(msg);
      });
      const _receiver2 = new CrossWindowSyncManager("r2", "channel", (msg) => {
        received2.push(msg);
      });

      sender.send("broadcast", { value: 42 });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);

      sender.close();
      _receiver1.close();
      _receiver2.close();
    });
  });

  // ---------------------------------------------------------------------------
  // 对话切换同步
  // ---------------------------------------------------------------------------

  describe("对话切换同步", () => {
    it("主窗口切换对话后应保持 PDF 对话 ID 不变", async () => {
      useChatStore.getState().setPdfConversationId("pdf-conv-sync");

      const conv1 = await useChatStore.getState().addConversation("对话1");
      await new Promise((r) => setTimeout(r, 10));
      const conv2 = await useChatStore.getState().addConversation("对话2");

      // 主窗口当前是 conv2
      expect(useChatStore.getState().currentConversationId).toBe(conv2);
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-conv-sync");

      // 切换到 conv1
      await useChatStore.getState().setCurrentConversation(conv1);
      expect(useChatStore.getState().currentConversationId).toBe(conv1);
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-conv-sync");
    });

    it("模拟跨窗口对话切换：主窗口通知 PDF 窗口", async () => {
      const pdfReceived: BroadcastMessage[] = [];

      const mainWindow = new CrossWindowSyncManager("main", "zotero-seek-sync", () => {});
      const _pdfWindow = new CrossWindowSyncManager("pdf", "zotero-seek-sync", (msg) => {
        pdfReceived.push(msg);
      });

      // 主窗口创建对话
      const convId = await useChatStore.getState().addConversation("新对话");

      // 模拟主窗口通过 BroadcastChannel 通知 PDF 窗口
      mainWindow.send("conversation-changed", { id: convId });

      expect(pdfReceived).toHaveLength(1);
      expect(pdfReceived[0].payload).toEqual({ id: convId });

      mainWindow.close();
      _pdfWindow.close();
    });

    it("模拟 PDF 窗口关闭通知主窗口清理 pdfConversationId", () => {
      const mainReceived: BroadcastMessage[] = [];

      const mainWindow = new CrossWindowSyncManager("main", "zotero-seek-sync", (msg) => {
        mainReceived.push(msg);
      });
      const _pdfWindow = new CrossWindowSyncManager("pdf", "zotero-seek-sync", () => {});

      // 设置 PDF 对话 ID
      useChatStore.getState().setPdfConversationId("pdf-conv-closing");
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-conv-closing");

      // 模拟 PDF 窗口关闭时通知主窗口
      _pdfWindow.send("pdf-closed", { conversationId: "pdf-conv-closing" });

      // 主窗口收到通知后清除 PDF 对话 ID
      expect(mainReceived).toHaveLength(1);
      expect(mainReceived[0].type).toBe("pdf-closed");

      // 模拟主窗口处理关闭通知
      useChatStore.getState().setPdfConversationId(null);
      expect(useChatStore.getState().pdfConversationId).toBeNull();

      mainWindow.close();
      _pdfWindow.close();
    });

    it("模拟 PDF 窗口打开时同步已有对话", async () => {
      // 主窗口已有对话
      const convId = await useChatStore.getState().addConversation("已有对话");
      await useChatStore.getState().addMessage("user", "你好");

      // 模拟 PDF 窗口打开时，通过 BroadcastChannel 查询当前状态
      const mainReceived: BroadcastMessage[] = [];
      const pdfReceived: BroadcastMessage[] = [];
      const mainWindow = new CrossWindowSyncManager("main", "zotero-seek-sync", (msg) => {
        mainReceived.push(msg);
      });
      const _pdfWindow = new CrossWindowSyncManager("pdf", "zotero-seek-sync", (msg) => {
        pdfReceived.push(msg);
      });

      // PDF 窗口请求当前状态
      _pdfWindow.send("request-state", {});

      // 主窗口应收到请求
      expect(mainReceived).toHaveLength(1);
      expect(mainReceived[0].type).toBe("request-state");

      // 主窗口响应（模拟）
      mainWindow.send("state-response", {
        currentConversationId: useChatStore.getState().currentConversationId,
        conversationCount: useChatStore.getState().conversations.length,
      });

      // PDF 窗口应收到响应
      expect(pdfReceived).toHaveLength(1);
      expect(pdfReceived[0].type).toBe("state-response");
      expect((pdfReceived[0].payload as any).currentConversationId).toBe(convId);

      mainWindow.close();
      _pdfWindow.close();
    });
  });

  // ---------------------------------------------------------------------------
  // 并发操作
  // ---------------------------------------------------------------------------

  describe("并发操作", () => {
    it("主窗口和 PDF 窗口可同时操作各自的对话 ID", async () => {
      const mainConvId = await useChatStore.getState().addConversation("主窗口对话");

      // PDF 窗口设置对话 ID（模拟同时操作）
      useChatStore.getState().setPdfConversationId("pdf-concurrent");

      // 主窗口添加消息
      await useChatStore.getState().addMessage("user", "主窗口消息");

      // 两个 ID 都应保持正确
      expect(useChatStore.getState().currentConversationId).toBe(mainConvId);
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-concurrent");
      expect(useChatStore.getState().messages).toHaveLength(1);
      expect(useChatStore.getState().messages[0].content).toBe("主窗口消息");
    });

    it("快速切换 PDF 对话 ID 应保持最终值", () => {
      useChatStore.getState().setPdfConversationId("pdf-1");
      useChatStore.getState().setPdfConversationId("pdf-2");
      useChatStore.getState().setPdfConversationId("pdf-3");
      useChatStore.getState().setPdfConversationId(null);
      useChatStore.getState().setPdfConversationId("pdf-final");

      expect(useChatStore.getState().pdfConversationId).toBe("pdf-final");
    });

    it("并发创建对话不应互相干扰", async () => {
      useChatStore.getState().setPdfConversationId("pdf-conv");

      // 同时创建多个对话（主窗口操作）
      const promises = [
        useChatStore.getState().addConversation("并发对话1"),
        useChatStore.getState().addConversation("并发对话2"),
        useChatStore.getState().addConversation("并发对话3"),
      ];

      const ids = await Promise.all(promises);

      // 所有对话都应被创建
      expect(ids).toHaveLength(3);
      ids.forEach((id) => expect(typeof id).toBe("string"));

      // PDF 对话 ID 应保持不变
      expect(useChatStore.getState().pdfConversationId).toBe("pdf-conv");

      // 当前对话应为最后创建的
      expect(useChatStore.getState().currentConversationId).toBe(ids[2]);
    });
  });

  // ---------------------------------------------------------------------------
  // PDF 模式消息持久化（chatDb 兼容层）
  // ---------------------------------------------------------------------------

  describe("PDF 模式消息持久化", () => {
    it("PDF 窗口可通过 chatDb 读写对话数据", async () => {
      const { chatDb } = await import("@/stores/chatStore");

      const now = new Date();
      const convId = "pdf-db-test-conv";

      // PDF 窗口写入对话
      await chatDb.conversations.add({
        id: convId,
        title: "PDF 测试对话",
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "这是 PDF 对话中的消息",
            timestamp: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });

      // 设置 PDF 对话 ID
      useChatStore.getState().setPdfConversationId(convId);

      // 读取对话
      const conversation = await chatDb.conversations.get(convId);
      expect(conversation).toBeDefined();
      expect(conversation!.id).toBe(convId);
      expect(conversation!.title).toBe("PDF 测试对话");
      expect(conversation!.messages).toHaveLength(1);
      expect(conversation!.messages[0].content).toBe("这是 PDF 对话中的消息");
    });

    it("PDF 窗口可更新对话消息", async () => {
      const { chatDb } = await import("@/stores/chatStore");

      const now = new Date();
      const convId = "pdf-update-test";

      // 创建初始对话
      await chatDb.conversations.add({
        id: convId,
        title: "可更新对话",
        messages: [],
        createdAt: now,
        updatedAt: now,
      });

      // 更新消息
      const messages: Message[] = [
        { id: "msg-1", role: "user", content: "问题", timestamp: now },
        { id: "msg-2", role: "assistant", content: "回答", timestamp: now },
      ];

      await chatDb.conversations.update(convId, {
        messages,
        updatedAt: new Date(),
      });

      // 读取验证
      const conversation = await chatDb.conversations.get(convId);
      expect(conversation!.messages).toHaveLength(2);
      expect(conversation!.messages[0].role).toBe("user");
      expect(conversation!.messages[1].role).toBe("assistant");
    });

    it("读取不存在的对话应返回 undefined", async () => {
      const { chatDb } = await import("@/stores/chatStore");

      const conversation = await chatDb.conversations.get("non-existent-id");
      expect(conversation).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Store 订阅机制
  // ---------------------------------------------------------------------------

  describe("store 订阅", () => {
    it("订阅者应收到 pdfConversationId 变化通知", () => {
      const changes: Array<{ pdfConversationId: string | null }> = [];

      const unsubscribe = useChatStore.subscribe((state) => {
        changes.push({ pdfConversationId: state.pdfConversationId });
      });

      useChatStore.getState().setPdfConversationId("sub-1");
      useChatStore.getState().setPdfConversationId("sub-2");
      useChatStore.getState().setPdfConversationId(null);

      expect(changes).toHaveLength(3);
      expect(changes[0].pdfConversationId).toBe("sub-1");
      expect(changes[1].pdfConversationId).toBe("sub-2");
      expect(changes[2].pdfConversationId).toBeNull();

      unsubscribe();
    });

    it("多个订阅者应独立接收通知", () => {
      const changes1: string[] = [];
      const changes2: string[] = [];

      const unsub1 = useChatStore.subscribe((state) => {
        if (state.pdfConversationId !== null) {
          changes1.push(state.pdfConversationId);
        }
      });

      const unsub2 = useChatStore.subscribe((state) => {
        if (state.pdfConversationId !== null) {
          changes2.push(state.pdfConversationId);
        }
      });

      useChatStore.getState().setPdfConversationId("shared-update");

      expect(changes1).toEqual(["shared-update"]);
      expect(changes2).toEqual(["shared-update"]);

      unsub1();
      unsub2();
    });

    it("取消订阅后不应再收到通知", () => {
      const changes: string[] = [];

      const unsubscribe = useChatStore.subscribe((state) => {
        if (state.pdfConversationId !== null) {
          changes.push(state.pdfConversationId);
        }
      });

      useChatStore.getState().setPdfConversationId("before-unsub");
      unsubscribe();
      useChatStore.getState().setPdfConversationId("after-unsub");

      expect(changes).toEqual(["before-unsub"]);
    });
  });
});
