/**
 * Keyboard shortcuts for ZoteroSeek
 *
 * Uses ztoolkit.Keyboard API (KeyboardManager) for shortcut registration.
 */

export function registerShortcuts(): void {
  // Register keyboard shortcuts using KeyboardManager
  ztoolkit.Keyboard.register((ev: KeyboardEvent, data: { type: string; keyboard?: any }) => {
    if (data.type === 'keyup' && data.keyboard) {
      // Ctrl/Cmd + Shift + S: Toggle ZoteroSeek panel
      if (data.keyboard.equals('accel,shift,s')) {
        try {
          addon.togglePanel();
        } catch (error) {
          Zotero.log(`[ZoteroSeek] Error toggling panel: ${error}`);
        }
      }
      // Ctrl/Cmd + Shift + A: Analyze selected items
      if (data.keyboard.equals('accel,shift,a')) {
        const items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (items.length > 0) {
          try {
            addon.togglePanel();
          } catch (error) {
            Zotero.log(`[ZoteroSeek] Error toggling panel: ${error}`);
          }
        }
      }
    }
  });
}
