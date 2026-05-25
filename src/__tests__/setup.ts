/**
 * Vitest 全局测试设置
 * Mock Zotero 全局对象和 ztoolkit
 */

import { vi } from 'vitest';

// Mock Zotero.getMainWindow() — must be set BEFORE React import
// The postinstall script patches node_modules/react to use Zotero.getMainWindow().require('react')
// In tests, we need to return the actual React module from this mock
(globalThis as any).Zotero = {
  getMainWindow: () => ({
    require: (id: string) => {
      if (id === 'react') return require('react');
      if (id === 'react-dom') return require('react-dom');
      throw new Error(`Unknown module: ${id}`);
    },
  }),

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
