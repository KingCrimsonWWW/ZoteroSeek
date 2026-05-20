/**
 * Menu registration for ZoteroSeek
 */

import { getString } from '../utils/locale';

export function registerMenus(): void {
  // Register tools menu item
  const menuIcon = `chrome://${config.addonRef}/content/icons/icon.png`;

  ztoolkit.Menu.register('menuTools', {
    id: `${config.addonRef}-tools-menu`,
    label: getString('menu.tools'),
    icon: menuIcon,
    commandListener: (_ev) => {
      // Open main panel
      Zotero.ZoteroSeek?.showPanel();
    },
  });

  // Register context menu for items
  ztoolkit.Menu.register('item', {
    id: `${config.addonRef}-item-menu`,
    label: getString('menu.analyze'),
    icon: menuIcon,
    commandListener: async (_ev) => {
      const items = Zotero.getActiveZoteroPane().getSelectedItems();
      if (items.length > 0) {
        Zotero.ZoteroSeek?.analyzeItems(items);
      }
    },
  });
}

import { config } from '../../package.json';
