/**
 * Preferences pane registration for ZoteroSeek
 */

import { config } from '../../package.json';

export function registerPrefs(): void {
  // Use hardcoded label — getString requires Fluent which may not
  // be initialized when registerPrefs() runs during onStartup()
  const prefPane = {
    pluginID: config.addonID,
    src: `chrome://${config.addonRef}/content/preferences.xhtml`,
    label: 'ZoteroSeek',
    image: `chrome://${config.addonRef}/content/icons/icon.png`,
  };

  Zotero.PreferencePanes.register(prefPane);
}
