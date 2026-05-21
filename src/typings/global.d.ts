/**
 * Global type declarations for Zotero Plugin
 */

// Zotero globals
declare const Zotero: {
  [key: string]: any;
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
  ZoteroSeek?: {
    showPanel(): void;
    togglePanel(): void;
    analyzeItems(items: any[]): void;
  };
};

declare const ztoolkit: {
  [key: string]: any;
  UI: {
    createElement(doc: Document, tag: string, options?: any): HTMLElement;
    appendElement(options: any, container: any): HTMLElement;
  };
  Menu: {
    register(menu: string, options: any): void;
  };
  Shortcut: {
    register(type: string, options: any): void;
  };
  log(...args: any[]): void;
};

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

// React JSX
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
