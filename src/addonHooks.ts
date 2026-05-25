/**
 * Lifecycle hooks for ZoteroSeek plugin
 *
 * Uses a hybrid approach:
 * 1. Show a lightweight vanilla JS UI immediately (non-blocking)
 * 2. Load React app asynchronously in the background
 */

import { config } from '../package.json';
import { initLocale } from '@/utils/locale';
import { registerMenus } from '@/modules/menu';
import { registerShortcuts } from '@/modules/shortcut';
import { registerPrefs } from '@/modules/preferences';
import { initChatStore } from './stores/chatStore';

// Track React roots for cleanup
let reactRoot: any = null;
let reactContainer: HTMLElement | null = null;
let isLoadingReact = false;
let userDismissed = false;

/**
 * Called when the plugin starts up.
 * Registers menus/shortcuts/prefs and auto-shows the React panel.
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
 * Create a lightweight vanilla JS UI immediately
 */
function createLightweightUI(window: Window): HTMLElement {
  const doc = window.document;
  
  // Create container
  const container = doc.createElement('div');
  container.id = `${config.addonRef}-container`;
  container.style.cssText = `
    position: fixed;
    top: 100px;
    left: 100px;
    width: 600px;
    height: 600px;
    z-index: 9999;
    background: linear-gradient(135deg, #eff6ff, #f5f3ff);
    border-radius: 12px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;
  
  // Header
  const header = doc.createElement('div');
  header.style.cssText = `
    background: linear-gradient(90deg, #2563eb, #7c3aed);
    color: white;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
    border-radius: 12px 12px 0 0;
  `;
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
      </svg>
      <span style="font-weight: 600;">ZoteroSeek</span>
    </div>
    <button id="${config.addonRef}-close" style="background: none; border: none; color: white; cursor: pointer; padding: 4px; border-radius: 50%;">
      <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  `;
  container.appendChild(header);
  
  // Content area with loading message
  const content = doc.createElement('div');
  content.style.cssText = `
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    color: #6b7280;
  `;
  content.innerHTML = `
    <div style="text-align: center;">
      <div style="animation: spin 1s linear infinite; margin: 0 auto 16px; width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%;"></div>
      <p>Loading ZoteroSeek...</p>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    </div>
  `;
  container.appendChild(content);
  
  // Close button handler
  const closeBtn = header.querySelector(`#${config.addonRef}-close`);
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      userDismissed = true;
      container.style.display = 'none';
    });
  }
  
  // Make draggable
  let isDragging = false;
  let startX = 0, startY = 0;
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX - container.offsetLeft;
    startY = e.clientY - container.offsetTop;
  });
  doc.addEventListener('mousemove', (e) => {
    if (isDragging) {
      container.style.left = (e.clientX - startX) + 'px';
      container.style.top = (e.clientY - startY) + 'px';
    }
  });
  doc.addEventListener('mouseup', () => { isDragging = false; });
  
  doc.documentElement.appendChild(container);
  return container;
}

/**
 * Load React app asynchronously (non-blocking)
 */
async function loadReactApp(window: Window): Promise<void> {
  // Guard: prevent duplicate loading
  if (reactContainer || isLoadingReact) return;

  try {
    isLoadingReact = true;
    Zotero.log('[ZoteroSeek] Loading React app asynchronously...');
    
    // Use setTimeout to defer loading to next tick
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Dynamic import to load React and all dependencies
    const { createRoot } = await import('react-dom/client');
    const React = await import('react');
    const { Container } = await import('./views/Container');
    
    // Create React container
    const doc = window.document;
    const container = doc.createElement('div');
    container.id = `${config.addonRef}-react-root`;
    container.style.cssText = `
      position: fixed;
      top: 100px;
      left: 100px;
      width: 600px;
      height: 600px;
      z-index: 9999;
    `;
    doc.documentElement.appendChild(container);
    
    // Create React root and render
    reactRoot = createRoot(container);
    reactRoot.render(React.createElement(Container, {
      onContainerHide: () => {
        if (reactContainer) reactContainer.style.display = 'none';
      },
    }));
    reactContainer = container;
    
    // Hide the lightweight UI
    const lightweightUI = doc.getElementById(`${config.addonRef}-container`);
    if (lightweightUI) {
      lightweightUI.style.display = 'none';
    }
    
    Zotero.log('[ZoteroSeek] React app loaded successfully');
  } catch (error) {
    Zotero.log(`[ZoteroSeek] Error loading React app: ${error}`);
  } finally {
    isLoadingReact = false;
  }
}

/**
 * Show the panel
 */
async function showPanel(): Promise<void> {
  // If user explicitly dismissed, don't re-show
  if (userDismissed) return;

  const win = Zotero.getMainWindow();
  if (!win) {
    Zotero.log('[ZoteroSeek] No main window available');
    return;
  }

  // Check if React app is already loaded
  if (reactContainer) {
    reactContainer.style.display = 'block';
    return;
  }

  // Check if lightweight UI exists
  const lightweightUI = win.document.getElementById(`${config.addonRef}-container`);
  if (lightweightUI) {
    lightweightUI.style.display = 'block';
    // Start loading React app in background
    loadReactApp(win);
    return;
  }

  // Create lightweight UI first
  createLightweightUI(win);
  // Then load React app in background
  loadReactApp(win);
}

/**
 * Toggle the panel visibility
 */
async function togglePanel(): Promise<void> {
  const win = Zotero.getMainWindow();
  if (!win) return;

  // Check React container first
  if (reactContainer) {
    reactContainer.style.display = reactContainer.style.display === 'none' ? 'block' : 'none';
    if (reactContainer.style.display === 'block') {
      userDismissed = false;
    }
    return;
  }

  // Check lightweight UI
  const lightweightUI = win.document.getElementById(`${config.addonRef}-container`);
  if (lightweightUI) {
    lightweightUI.style.display = lightweightUI.style.display === 'none' ? 'block' : 'none';
    // Reset userDismissed when user explicitly re-opens
    if (lightweightUI.style.display === 'block') {
      userDismissed = false;
    }
    return;
  }

  // Create and show
  await showPanel();
}

/**
 * Called when the plugin shuts down.
 */
function onShutdown(): void {
  // Unregister all ztoolkit registrations
  ztoolkit.unregisterAll();

  // Cleanup React root
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  reactContainer = null;

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
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  reactContainer = null;
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
