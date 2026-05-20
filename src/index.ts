/**
 * ZoteroSeek - AI-powered research assistant for Zotero
 *
 * Main entry point for the plugin.
 * This file initializes the plugin and registers event handlers.
 */

import { config } from '../package.json';
import { initLocale } from './utils/locale';
import { registerMenus } from './modules/menu';
import { registerShortcuts } from './modules/shortcut';
import { registerPrefs } from './modules/preferences';

// Plugin lifecycle hooks
class ZoteroSeek {
  private static initialized = false;

  /**
   * Called when the plugin is loaded
   */
  static startup(): void {
    if (this.initialized) {
      return;
    }

    console.log(`${config.addonName} starting...`);

    // Initialize locale/i18n
    initLocale();

    // Register menu items
    registerMenus();

    // Register keyboard shortcuts
    registerShortcuts();

    // Register preferences pane
    registerPrefs();

    this.initialized = true;
    console.log(`${config.addonName} started successfully`);
  }

  /**
   * Called when the plugin is unloaded
   */
  static shutdown(): void {
    console.log(`${config.addonName} shutting down...`);
    // Cleanup resources here
  }
}

// Export for Zotero to call
export default ZoteroSeek;
