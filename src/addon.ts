/**
 * Addon class for ZoteroSeek
 *
 * Main addon instance that holds lifecycle hooks and runtime data.
 * Follows the Zotero plugin scaffold pattern.
 */

import { BasicTool, ZoteroToolkit } from 'zotero-plugin-toolkit';
import { config } from '../package.json';
import hooks from './addonHooks';

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

  analyzeItems(_items: any[]): void {
    // Stub - 功能未实现
    Zotero.log('[ZoteroSeek] analyzeItems not implemented yet');
  }
}

// Initialize global variables (only once)
if (!basicTool.getGlobal('Zotero')[config.addonInstance]) {
  // Set global variables from Zotero context
  _globalThis.Zotero = basicTool.getGlobal('Zotero');
  _globalThis.ZoteroPane = basicTool.getGlobal('ZoteroPane');
  _globalThis.Zotero_Tabs = basicTool.getGlobal('Zotero_Tabs');
  _globalThis.window = basicTool.getGlobal('window');
  _globalThis.document = basicTool.getGlobal('document');
  _globalThis.URL = basicTool.getGlobal('window').URL;
  _globalThis.setTimeout = basicTool.getGlobal('window').setTimeout;
  _globalThis.URLSearchParams = basicTool.getGlobal('window').URLSearchParams;
  _globalThis.Headers = basicTool.getGlobal('window').Headers;
  _globalThis.AbortSignal = basicTool.getGlobal('window').AbortSignal;
  _globalThis.Request = basicTool.getGlobal('window').Request;

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
