/**
 * Menu registration for ZoteroSeek
 */

import { config } from '../../package.json';
import { getString } from '../utils/locale';

export function registerMenus(): void {
  // Register tools menu item
  const menuIcon = `chrome://${config.addonRef}/content/icons/icon.png`;

  ztoolkit.Menu.register('menuTools', {
    tag: "menuitem",
    id: `${config.addonRef}-tools-menu`,
    label: getString('menu-tools'),
    icon: menuIcon,
    commandListener: async (_ev: Event) => {
      // Open main panel (lazy loading)
      try {
        await addon.showPanel();
      } catch (error) {
        Zotero.log(`[ZoteroSeek] Error showing panel: ${error}`);
      }
    },
  });

  // Register context menu for items
  ztoolkit.Menu.register('item', {
    tag: "menuitem",
    id: `${config.addonRef}-item-menu`,
    label: getString('menu-analyze'),
    icon: menuIcon,
    commandListener: async (_ev: Event) => {
      const items = Zotero.getActiveZoteroPane().getSelectedItems();
      if (items.length > 0) {
        await addon.showPanel();
      }
    },
  });
}
