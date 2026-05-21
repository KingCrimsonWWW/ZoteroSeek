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
  try {
    Zotero.log('[ZoteroSeek] onMainWindowLoad called');
    
    // Create a container div for the React app
    const doc = window.document;
    const container = doc.createElement('div');
    container.id = `${config.addonRef}-container`;
    
    // Style the container to be visible
    container.style.position = 'fixed';
    container.style.top = '100px';
    container.style.left = '100px';
    container.style.zIndex = '9999';
    
    doc.documentElement.appendChild(container);
    Zotero.log('[ZoteroSeek] Container created and appended to document');

    // Create React root and render
    const root = createRoot(container);
    root.render(React.createElement(Container));
    roots.set(window, root);
    
    Zotero.log('[ZoteroSeek] React root rendered');
  } catch (error) {
    Zotero.log(`[ZoteroSeek] Error in onMainWindowLoad: ${error}`);
  }
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
