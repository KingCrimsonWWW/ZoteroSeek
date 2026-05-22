/**
 * Addon class for ZoteroSeek
 *
 * Main addon instance that holds lifecycle hooks and runtime data.
 * Follows the Zotero plugin scaffold pattern.
 */

import { BasicTool, ZoteroToolkit } from 'zotero-plugin-toolkit';
import { config } from '../package.json';
import hooks from './addonHooks';
import { openPdfChatWindow } from './modules/pdfChatWindow';

const basicTool = new BasicTool();

class Addon {
  public data: {
    alive: boolean;
    env: 'development' | 'production';
    ztoolkit: ZoteroToolkit;
    locale?: {
      current: any;
    };
  };

  // Lifecycle hooks
  public hooks: typeof hooks;

  // APIs (extend as needed)
  public api: Record<string, unknown>;

  constructor() {
    this.data = {
      alive: true,
      env: __env__,
      ztoolkit: new ZoteroToolkit(),
    };
    this.hooks = hooks;
    this.api = {};
  }

  showPanel(): void {
    const win = Zotero.getMainWindow();
    const container = win?.document.getElementById('zoteroseek-container');
    if (container) {
      container.style.display = 'block';
    }
  }

  togglePanel(): void {
    const win = Zotero.getMainWindow();
    const container = win?.document.getElementById('zoteroseek-container');
    if (container) {
      container.style.display = container.style.display === 'none' ? 'block' : 'none';
    }
  }

  hidePanel(): void {
    const win = Zotero.getMainWindow();
    const container = win?.document.getElementById('zoteroseek-container');
    if (container) {
      container.style.display = 'none';
    }
  }

  /**
   * Open the standalone PDF chat window.
   * Delegates to pdfChatWindow module for window lifecycle management.
   */
  openPdfChat(): void {
    openPdfChatWindow();
  }

}

// Initialize global variables (only once)
if (!basicTool.getGlobal('Zotero')[config.addonInstance]) {
  // Set global variables from Zotero context
  _globalThis.Zotero = basicTool.getGlobal('Zotero');
  _globalThis.ZoteroPane = basicTool.getGlobal('ZoteroPane');
  _globalThis.Zotero_Tabs = basicTool.getGlobal('Zotero_Tabs');
  const win = basicTool.getGlobal('window');
  _globalThis.window = win;
  _globalThis.document = basicTool.getGlobal('document');

  // Fix for Zotero 9: timer functions must be bound to a Window object.
  // React's dynamic import() resolves setTimeout from globalThis,
  // NOT from _globalThis, so we must patch BOTH.
  const boundSetTimeout = win.setTimeout.bind(win);
  const boundSetInterval = win.setInterval.bind(win);
  const boundClearTimeout = win.clearTimeout.bind(win);
  const boundClearInterval = win.clearInterval.bind(win);

  _globalThis.setTimeout = boundSetTimeout;
  _globalThis.setInterval = boundSetInterval;
  _globalThis.clearTimeout = boundClearTimeout;
  _globalThis.clearInterval = boundClearInterval;

  // Also patch globalThis (React's import() uses this scope)
  globalThis.setTimeout = boundSetTimeout;
  globalThis.setInterval = boundSetInterval;
  globalThis.clearTimeout = boundClearTimeout;
  globalThis.clearInterval = boundClearInterval;

  // Zotero 9 sandbox: React DOM needs navigator for feature detection.
  // Polyfill it on both globalThis and _globalThis.
  if (typeof globalThis.navigator === 'undefined') {
    const nav = { onLine: true, userAgent: 'Zotero/9.0' } as unknown as Navigator;
    _globalThis.navigator = nav;
    (globalThis as any).navigator = nav;
  }

  _globalThis.URL = win.URL;
  _globalThis.URLSearchParams = win.URLSearchParams;
  _globalThis.Headers = win.Headers;
  _globalThis.AbortSignal = win.AbortSignal;
  _globalThis.Request = win.Request;

  // Polyfill AbortSignal.timeout if not available
  if (!_globalThis.AbortSignal.timeout) {
    _globalThis.AbortSignal.timeout = (ms: number) => {
      const controller = new window.AbortController();
      const timer = window.setTimeout(() => controller.abort(), ms);
      controller.signal.addEventListener('abort', () => {
        window.clearTimeout(timer);
      });
      return controller.signal;
    };
  }

  // Create and register addon instance
  _globalThis.addon = new Addon();
  _globalThis.ztoolkit = addon.data.ztoolkit;

  // Configure toolkit
  ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  ztoolkit.basicOptions.log.disableConsole = addon.data.env === 'production';
  ztoolkit.UI.basicOptions.ui.enableElementJSONLog = false;
  ztoolkit.UI.basicOptions.ui.enableElementDOMLog = false;
  ztoolkit.basicOptions.debug.disableDebugBridgePassword =
    addon.data.env === 'development';

  // Register addon instance on Zotero object
  // NOTE: onStartup is called by bootstrap.js after this script loads
  Zotero[config.addonInstance] = addon;
  Zotero.__addonInstance__ = addon;  // Required for bootstrap.js hooks
}

export default Addon;
