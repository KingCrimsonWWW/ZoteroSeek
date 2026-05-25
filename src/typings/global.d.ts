/**
 * Global type declarations for Zotero Plugin
 */

// Mozilla Fluent Localization API (available in Zotero's privileged environment)
declare class Localization {
  constructor(resourceIds: string[], eager?: boolean);
  formatMessagesSync(
    keys: Array<{ id: string; args?: Record<string, unknown> }>,
  ): Array<{
    value: string | null;
    attributes: Record<string, string> | null;
  }>;
}

// Environment variable injected by build tool
declare const __env__: 'development' | 'production';

// rootURI is injected by bootstrap.js via loadSubScript ctx
// Used for file:// URIs to plugin resources (preferred over chrome:// for some APIs)
declare const rootURI: string;

// Global addon instance
declare const addon: import('./addon').default;

// Zotero globals
declare const Zotero: {
  [key: string]: any;
  initializationPromise: Promise<void>;
  unlockPromise: Promise<void>;
  uiReadyPromise: Promise<void>;
  getActiveZoteroPane(): any;
  Items: {
    get(id: number): any;
    getAsync(id: number): Promise<any>;
  };
  Prefs: {
    get(key: string, globalBranch?: boolean): any;
    set(key: string, value: any, globalBranch?: boolean): void;
    clear(key: string, globalBranch?: boolean): void;
  };
  getString(key: string, params?: any): string;
  PreferencePanes: {
    register(pane: any): void;
  };
  isMac: boolean;
};

declare const ztoolkit: import('../toolkit').CustomToolkit;

declare const Zotero_Tabs: {
  selectedIndex: number;
  selectedID: string;
};

declare const Components: {
  utils: {
    isDeadWrapper(obj: any): boolean;
    import(url: string): any;
  };
};

// GlobalThis extensions for Zotero plugin context
declare const _globalThis: typeof globalThis & {
  Zotero: typeof Zotero;
  ZoteroPane: any;
  Zotero_Tabs: typeof Zotero_Tabs;
  window: Window;
  document: Document;
  URL: typeof URL;
  setTimeout: typeof setTimeout;
  URLSearchParams: typeof URLSearchParams;
  Headers: typeof Headers;
  AbortSignal: typeof AbortSignal & {
    timeout(ms: number): AbortSignal;
  };
  Request: typeof Request;
  addon: typeof addon;
  ztoolkit: typeof ztoolkit;
};

// React JSX
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
