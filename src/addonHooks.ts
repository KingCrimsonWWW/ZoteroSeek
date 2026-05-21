/**
 * Lifecycle hooks for ZoteroSeek plugin
 *
 * These hooks are called by bootstrap.js during the plugin lifecycle:
 * - onStartup: Plugin initialization (lightweight)
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

// Track React roots for cleanup
const roots = new Map<Window, Root>();

// Lazy-loaded Container component
let ContainerModule: typeof import('./views/Container') | null = null;

/**
 * Lazy load the Container component
 */
async function getContainer() {
  if (!ContainerModule) {
    ContainerModule = await import('./views/Container');
  }
  return ContainerModule.Container;
}

/**
 * Called when the plugin starts up.
 * Only registers menus/shortcuts/prefs (lightweight, no React).
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

  // Expose showPanel/togglePanel on the addon instance
  addon.showPanel = () => ensureUI().then(() => showPanel());
  addon.togglePanel = () => ensureUI().then(() => togglePanel());
  
  Zotero.log('[ZoteroSeek] onStartup complete');
}

/**
 * Ensure the React UI is created (lazy loading)
 */
async function ensureUI(): Promise<void> {
  const win = Zotero.getMainWindow();
  if (!win) {
    Zotero.log('[ZoteroSeek] No main window available');
    return;
  }

  // Check if container already exists
  const existingContainer = win.document.getElementById(`${config.addonRef}-container`);
  if (existingContainer) {
    Zotero.log('[ZoteroSeek] Container already exists');
    return;
  }

  // Create the React UI lazily
  await createReactUI(win);
}

/**
 * Create the React UI in the given window (lazy loading)
 */
async function createReactUI(window: Window): Promise<void> {
  try {
    Zotero.log('[ZoteroSeek] Creating React UI (lazy)');
    
    // Lazy load the Container component
    const Container = await getContainer();
    
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
    Zotero.log(`[ZoteroSeek] Error in createReactUI: ${error}`);
  }
}

/**
 * Show the panel (create UI if needed)
 */
async function showPanel(): Promise<void> {
  await ensureUI();
  const win = Zotero.getMainWindow();
  if (win) {
    const container = win.document.getElementById(`${config.addonRef}-container`);
    if (container) {
      container.style.display = 'block';
    }
  }
}

/**
 * Toggle the panel visibility
 */
async function togglePanel(): Promise<void> {
  await ensureUI();
  const win = Zotero.getMainWindow();
  if (win) {
    const container = win.document.getElementById(`${config.addonRef}-container`);
    if (container) {
      container.style.display = container.style.display === 'none' ? 'block' : 'none';
    }
  }
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
 * Does NOT create React UI (lazy loading).
 */
function onMainWindowLoad(window: Window): void {
  Zotero.log('[ZoteroSeek] onMainWindowLoad called (no-op, lazy loading)');
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
