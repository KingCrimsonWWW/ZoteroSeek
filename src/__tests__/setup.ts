/**
 * Vitest 全局测试设置
 * Mock Zotero 全局对象和 ztoolkit
 */

import { vi } from 'vitest';

// Mock Zotero 全局对象
(globalThis as any).Zotero = {
  Prefs: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
  },
  HTTP: {
    request: vi.fn(),
  },
  Items: {
    get: vi.fn(),
    getAsync: vi.fn(),
  },
  getActiveZoteroPane: vi.fn(),
  getString: vi.fn(),
  PreferencePanes: {
    register: vi.fn(),
  },
  isMac: false,
};

// Mock ztoolkit 全局对象
(globalThis as any).ztoolkit = {
  log: vi.fn(),
  UI: {
    createElement: vi.fn(),
    appendElement: vi.fn(),
  },
  Menu: {
    register: vi.fn(),
  },
  Shortcut: {
    register: vi.fn(),
  },
};

// Mock Zotero_Tabs
(globalThis as any).Zotero_Tabs = {
  selectedIndex: 0,
  selectedID: '',
};
