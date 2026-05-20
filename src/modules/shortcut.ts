/**
 * Keyboard shortcuts for ZoteroSeek
 */

import { config } from '../../package.json';

export function registerShortcuts(): void {
  // Ctrl/Cmd + Shift + S: Open ZoteroSeek panel
  ztoolkit.Shortcut.register('event', {
    id: `${config.addonRef}-open-panel`,
    key: 's',
    modifiers: 'accel,shift',
    callback: () => {
      Zotero.ZoteroSeek?.togglePanel();
    },
  });

  // Ctrl/Cmd + Shift + A: Analyze selected items
  ztoolkit.Shortcut.register('event', {
    id: `${config.addonRef}-analyze`,
    key: 'a',
    modifiers: 'accel,shift',
    callback: () => {
      const items = Zotero.getActiveZoteroPane().getSelectedItems();
      if (items.length > 0) {
        Zotero.ZoteroSeek?.analyzeItems(items);
      }
    },
  });
}
