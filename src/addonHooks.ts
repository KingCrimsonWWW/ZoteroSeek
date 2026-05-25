/**
 * Lifecycle hooks for ZoteroSeek plugin
 *
 * Delegates UI window management to ReactRoot (views/root.ts).
 */

import { config } from '../package.json';
import { initLocale } from '@/utils/locale';
import { registerMenus } from '@/modules/menu';
import { registerShortcuts } from '@/modules/shortcut';
import { registerPrefs } from '@/modules/preferences';
import { initChatStore } from './stores/chatStore';
import { ReactRoot } from '@/views/root';

// Lazy-initialized ReactRoot instance
let reactRoot: ReactRoot | null = null;

function getReactRoot(): ReactRoot {
  if (!reactRoot) {
    const Keyboard = ztoolkit.Keyboard;
    reactRoot = new ReactRoot(Keyboard, { skipShortcut: true });
  }
  return reactRoot;
}

/**
 * Called when the plugin starts up.
 * Registers menus/shortcuts/prefs and exposes showPanel/togglePanel.
 */
async function onStartup() {
  Zotero.log('[ZoteroSeek] onStartup called');

  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  Zotero.log('[ZoteroSeek] Zotero initialized, registering components');

  // Initialize locale/i18n
  initLocale();

  // Register menu items
  registerMenus();
  Zotero.log('[ZoteroSeek] Menus registered');

  // Register keyboard shortcuts
  registerShortcuts();
  Zotero.log('[ZoteroSeek] Shortcuts registered');

  // Register preferences pane
  registerPrefs();
  Zotero.log('[ZoteroSeek] Preferences registered');

  // Initialize chat store (load conversation list)
  await initChatStore();
  Zotero.log('[ZoteroSeek] Chat store initialized');

  // Expose showPanel/togglePanel on the addon instance
  addon.showPanel = () => showPanel();
  addon.togglePanel = () => togglePanel();

  Zotero.log('[ZoteroSeek] onStartup complete');
}

/**
 * Show the panel via ReactRoot.
 */
function showPanel(): void {
  getReactRoot().launchApp();
}

/**
 * Toggle the panel visibility via ReactRoot.
 */
function togglePanel(): void {
  getReactRoot().toggleApp();
}

/**
 * Called when the plugin shuts down.
 */
function onShutdown(): void {
  // Unregister all ztoolkit registrations
  ztoolkit.unregisterAll();

  // Mark addon as dead
  addon.data.alive = false;

  // Remove addon from Zotero global
  delete Zotero[config.addonInstance];
}

/**
 * Called when the main window loads.
 */
function onMainWindowLoad(_window: Window): void {
  Zotero.log('[ZoteroSeek] onMainWindowLoad called (no-op)');
}

/**
 * Called when the main window unloads.
 */
function onMainWindowUnload(_window: Window): void {
  // ReactRoot dialog lifecycle is self-contained (dialogclosing event)
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
