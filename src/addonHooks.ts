/**
 * Lifecycle hooks for ZoteroSeek plugin
 *
 * These hooks are called by bootstrap.js during the plugin lifecycle:
 * - onStartup: Plugin initialization
 * - onShutdown: Plugin cleanup
 * - onMainWindowLoad: Main window ready
 * - onMainWindowUnload: Main window closing
 */

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { config } from '../package.json';
import { initLocale } from './utils/locale';
import { registerMenus } from './modules/menu';
import { registerShortcuts } from './modules/shortcut';
import { registerPrefs } from './modules/preferences';
import { Container } from './views/Container';

// Track React roots for cleanup
const roots = new Map<Window, Root>();

/**
 * Called when the plugin starts up.
 * Waits for Zotero to be fully initialized, then registers menus/shortcuts/prefs.
 */
async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // Initialize locale/i18n
  initLocale();

  // Register menu items
  registerMenus();

  // Register keyboard shortcuts
  registerShortcuts();

  // Register preferences pane
  registerPrefs();
}

/**
 * Called when the plugin shuts down.
 * Cleans up all registered resources and React roots.
 */
function onShutdown(): void {
  // Unregister all ztoolkit registrations
  ztoolkit.unregisterAll();

  // Cleanup all React roots
  for (const [_win, root] of roots) {
    root.unmount();
  }
  roots.clear();

  // Mark addon as dead
  addon.data.alive = false;

  // Remove addon from Zotero global
  delete Zotero[config.addonInstance];
}

/**
 * Called when the main window loads.
 * Creates the React container and renders the UI.
 */
function onMainWindowLoad(window: Window): void {
  // Create a container div for the React app
  const doc = window.document;
  const container = doc.createElement('div');
  container.id = `${config.addonRef}-container`;
  doc.documentElement.appendChild(container);

  // Create React root and render
  const root = createRoot(container);
  root.render(React.createElement(Container));
  roots.set(window, root);
}

/**
 * Called when the main window unloads.
 * Cleans up the React root for this window.
 */
function onMainWindowUnload(window: Window): void {
  const root = roots.get(window);
  if (root) {
    root.unmount();
    roots.delete(window);
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
