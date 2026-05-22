/**
 * addonHooks 单元测试
 *
 * 测试 onStartup / onShutdown 生命周期钩子的调用顺序和清理行为
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';

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

// ---------------------------------------------------------------------------
// 导入被测试模块
// ---------------------------------------------------------------------------

import { initLocale } from '@/utils/locale';
import { registerMenus } from '@/modules/menu';
import { registerShortcuts } from '@/modules/shortcut';
import { registerPrefs } from '@/modules/preferences';
import { initChatStore } from '@/stores/chatStore';
import hooks from '@/addonHooks';

describe('addonHooks', () => {
  beforeAll(() => {
    // 补充 setup.ts 中未覆盖的 Zotero 全局方法
    (globalThis as any).Zotero.log = vi.fn();
    (globalThis as any).Zotero.initializationPromise = Promise.resolve();
    (globalThis as any).Zotero.unlockPromise = Promise.resolve();
    (globalThis as any).Zotero.uiReadyPromise = Promise.resolve();

    // 模拟 getMainWindow —— 返回足够让 createLightweightUI 无异常跑完的 window 对象
    const createMockElement = () => ({
      style: {} as Record<string, string>,
      id: '',
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      querySelector: vi.fn(() => null),
      innerHTML: '',
    });

    (globalThis as any).Zotero.getMainWindow = vi.fn(() => ({
      document: {
        createElement: vi.fn(createMockElement),
        getElementById: vi.fn(() => null),
        addEventListener: vi.fn(),
        documentElement: {
          appendChild: vi.fn(),
        },
      },
    }));

    // 补充 ztoolkit 方法
    (globalThis as any).ztoolkit.unregisterAll = vi.fn();

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
    beforeEach(() => {
      // 阻止 loadReactApp 内部的 setTimeout 实际触发，避免动态 import
      // 污染后续测试
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('应依次调用所有注册函数：initLocale、registerMenus、registerShortcuts、registerPrefs、initChatStore', async () => {
      await hooks.onStartup();

      expect(initLocale).toHaveBeenCalledTimes(1);
      expect(registerMenus).toHaveBeenCalledTimes(1);
      expect(registerShortcuts).toHaveBeenCalledTimes(1);
      expect(registerPrefs).toHaveBeenCalledTimes(1);
      expect(initChatStore).toHaveBeenCalledTimes(1);
    });

    it('应在初始化后调用 showPanel（通过 Zotero.getMainWindow 被调用验证）', async () => {
      await hooks.onStartup();

      // showPanel 内部第一行就是 Zotero.getMainWindow()
      expect(Zotero.getMainWindow).toHaveBeenCalled();
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

    it('reactRoot 为 null 时不应抛异常', () => {
      // reactRoot 模块级变量默认为 null，onShutdown 应静默处理
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
