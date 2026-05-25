/**
 * addonHooks 单元测试
 *
 * 测试 onStartup / onShutdown 生命周期钩子的调用顺序和清理行为
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// 对 addonHooks.ts 中所有非全局依赖使用 vi.mock
// ---------------------------------------------------------------------------

vi.mock('@/utils/locale', () => ({
  initLocale: vi.fn(),
}));

vi.mock('@/modules/menu', () => ({
  registerMenus: vi.fn(),
}));

vi.mock('@/modules/shortcut', () => ({
  registerShortcuts: vi.fn(),
}));

vi.mock('@/modules/preferences', () => ({
  registerPrefs: vi.fn(),
}));

vi.mock('@/stores/chatStore', () => ({
  initChatStore: vi.fn().mockResolvedValue(undefined),
}));

// Mock ReactRoot — 避免真实 UI 注册
const mockLaunchApp = vi.fn();
const mockToggleApp = vi.fn();

vi.mock('@/views/root', () => {
  const MockReactRoot = vi.fn().mockImplementation(function (this: any) {
    this.launchApp = mockLaunchApp;
    this.toggleApp = mockToggleApp;
  });
  return { ReactRoot: MockReactRoot };
});

// ---------------------------------------------------------------------------
// 导入被测试模块
// ---------------------------------------------------------------------------

import { initLocale } from '@/utils/locale';
import { registerMenus } from '@/modules/menu';
import { registerShortcuts } from '@/modules/shortcut';
import { registerPrefs } from '@/modules/preferences';
import { initChatStore } from '@/stores/chatStore';
import { ReactRoot } from '@/views/root';
import hooks from '@/addonHooks';

describe('addonHooks', () => {
  beforeAll(() => {
    // 补充 setup.ts 中未覆盖的 Zotero 全局方法
    (globalThis as any).Zotero.log = vi.fn();
    (globalThis as any).Zotero.initializationPromise = Promise.resolve();
    (globalThis as any).Zotero.unlockPromise = Promise.resolve();
    (globalThis as any).Zotero.uiReadyPromise = Promise.resolve();

    // 补充 ztoolkit 方法和属性
    (globalThis as any).ztoolkit.unregisterAll = vi.fn();
    (globalThis as any).ztoolkit.Keyboard = {};

    // 补充 addon 全局对象
    (globalThis as any).addon = {
      data: { alive: true },
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // 确保每次测试前 addon 都处于初始状态
    (globalThis as any).addon = {
      data: { alive: true },
    };
  });

  // -----------------------------------------------------------------------
  // onStartup
  // -----------------------------------------------------------------------

  describe('onStartup', () => {
    it('应依次调用所有注册函数：initLocale、registerMenus、registerShortcuts、registerPrefs、initChatStore', async () => {
      await hooks.onStartup();

      expect(initLocale).toHaveBeenCalledTimes(1);
      expect(registerMenus).toHaveBeenCalledTimes(1);
      expect(registerShortcuts).toHaveBeenCalledTimes(1);
      expect(registerPrefs).toHaveBeenCalledTimes(1);
      expect(initChatStore).toHaveBeenCalledTimes(1);
    });

    it('不应在启动时自动创建 ReactRoot 或调用 getMainWindow', async () => {
      await hooks.onStartup();

      // onStartup 不应触发 ReactRoot 创建
      expect(ReactRoot).not.toHaveBeenCalled();
    });

    it('应在 addon 上暴露 showPanel 和 togglePanel', async () => {
      // onStartup 之前，addon 没有 showPanel / togglePanel
      expect((globalThis as any).addon.showPanel).toBeUndefined();
      expect((globalThis as any).addon.togglePanel).toBeUndefined();

      await hooks.onStartup();

      expect((globalThis as any).addon.showPanel).toBeInstanceOf(Function);
      expect((globalThis as any).addon.togglePanel).toBeInstanceOf(Function);
    });
  });

  // -----------------------------------------------------------------------
  // showPanel / togglePanel
  // -----------------------------------------------------------------------

  describe('showPanel / togglePanel', () => {
    beforeEach(async () => {
      await hooks.onStartup();
    });

    it('showPanel 应创建 ReactRoot 并调用 launchApp', () => {
      (globalThis as any).addon.showPanel();

      expect(ReactRoot).toHaveBeenCalledTimes(1);
      expect(ReactRoot).toHaveBeenCalledWith(
        expect.anything(),
        { skipShortcut: true },
      );
      expect(mockLaunchApp).toHaveBeenCalledTimes(1);
    });

    it('togglePanel 应复用已创建的 ReactRoot 并调用 toggleApp', () => {
      // reactRoot 已在上一个测试中创建
      const reactRootCallsBefore = (ReactRoot as any).mock.calls.length;

      (globalThis as any).addon.togglePanel();

      // 不应再创建新的 ReactRoot
      expect((ReactRoot as any).mock.calls.length).toBe(reactRootCallsBefore);
      expect(mockToggleApp).toHaveBeenCalledTimes(1);
    });

    it('多次调用 showPanel 应复用同一个 ReactRoot 实例', () => {
      // reactRoot 已在上一个测试中创建
      const reactRootCallsBefore = (ReactRoot as any).mock.calls.length;

      (globalThis as any).addon.showPanel();
      (globalThis as any).addon.showPanel();

      // 不应再创建新的 ReactRoot
      expect((ReactRoot as any).mock.calls.length).toBe(reactRootCallsBefore);
      expect(mockLaunchApp).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // onShutdown
  // -----------------------------------------------------------------------

  describe('onShutdown', () => {
    it('应调用 ztoolkit.unregisterAll 清理菜单/快捷键/偏好面板', () => {
      hooks.onShutdown();

      expect(ztoolkit.unregisterAll).toHaveBeenCalledTimes(1);
    });

    it('应将 addon 标记为 dead 并从 Zotero 全局移除', () => {
      // 模拟 onStartup 阶段设置的实例
      (globalThis as any).Zotero.ZoteroSeek = {};
      const addonRef = (globalThis as any).addon;

      hooks.onShutdown();

      expect(addonRef.data.alive).toBe(false);
      expect((globalThis as any).Zotero.ZoteroSeek).toBeUndefined();
    });

    it('未创建 ReactRoot 时不应抛异常', () => {
      // reactRoot 模块级变量默认为 null，onShutdown 不应访问它
      expect(() => hooks.onShutdown()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // onMainWindowLoad / onMainWindowUnload (轻量验证)
  // -----------------------------------------------------------------------

  describe('onMainWindowLoad / onMainWindowUnload', () => {
    it('onMainWindowLoad 应无异常执行', () => {
      const mockWindow = { document: { title: 'Zotero' } } as unknown as Window;
      expect(() => hooks.onMainWindowLoad(mockWindow)).not.toThrow();
    });

    it('onMainWindowUnload 应无异常执行', () => {
      const mockWindow = { document: { title: 'Zotero' } } as unknown as Window;
      expect(() => hooks.onMainWindowUnload(mockWindow)).not.toThrow();
    });
  });
});
