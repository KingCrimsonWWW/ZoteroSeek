/**
 * Preferences pane registration for ZoteroSeek
 *
 * Uses rootURI (file:// URI) for src, NOT chrome:// URIs.
 * Zotero's PreferencePanes.register() loads scripts via file I/O
 * which does NOT resolve chrome:// URIs through the chrome registry.
 * Script initialization is handled via onload on the vbox element
 * (see preferences.xhtml) and onPrefsLoad in addonHooks.ts.
 */

import { config } from '../../package.json';
import { getString } from '../utils/locale';

export function registerPrefs(): void {
  // rootURI is injected by bootstrap.js via loadSubScript ctx
  const root = typeof rootURI !== 'undefined' ? rootURI : '';
  const chromeContent = `${root}chrome/content/`;

  const prefPane = {
    pluginID: config.addonID,
    src: `${chromeContent}preferences.xhtml`,
    label: getString('prefs-title'),
    image: `${chromeContent}icons/icon.png`,
  };

  Zotero.PreferencePanes.register(prefPane);
}
