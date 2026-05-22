/**
 * Preferences pane registration for ZoteroSeek
 */

import { config } from '../../package.json';
import { getString } from '../utils/locale';

export function registerPrefs(): void {
  // Register preferences pane
  const prefPane = {
    pluginID: config.addonID,
    src: `chrome://${config.addonRef}/content/preferences.xhtml`,
    label: getString('prefs-title'),
    image: `chrome://${config.addonRef}/content/icons/icon.png`,
    scripts: [`chrome://${config.addonRef}/content/preferences.js`],
  };

  Zotero.PreferencePanes.register(prefPane);
}
