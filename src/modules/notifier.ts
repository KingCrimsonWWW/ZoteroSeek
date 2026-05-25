/**
 * Zotero Notifier observer for tab and item events.
 *
 * Lightweight logging-only observer — heavy operations should NOT be placed here.
 */

import { config } from '../../package.json';

let observerID: string | null = null;

/**
 * Observer callback for Zotero.Notifier.
 *
 * @param event  - "add" | "modify" | "delete" | "select" | …
 * @param type   - "tab" | "item" (the types we subscribe to)
 * @param ids    - array of affected IDs
 * @param extraData - additional event-specific data
 */
function notifyCallback(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
): void {
  // Log lightweight info — no heavy work here
  Zotero.log(
    `[${config.addonName}] Notifier event: ${event} type: ${type} ids: ${ids.join(',')}`,
  );
}

/**
 * Register the Notifier observer for tab and item events.
 */
export function registerNotifier(): void {
  if (observerID) {
    Zotero.log(`[${config.addonName}] Notifier already registered`);
    return;
  }

  observerID = Zotero.Notifier.registerObserver(notifyCallback, [
    'tab',
    'item',
  ]);

  Zotero.log(`[${config.addonName}] Notifier registered (id: ${observerID})`);
}

/**
 * Unregister the Notifier observer.
 */
export function unregisterNotifier(): void {
  if (!observerID) return;

  Zotero.Notifier.unregisterObserver(observerID);
  Zotero.log(`[${config.addonName}] Notifier unregistered (id: ${observerID})`);
  observerID = null;
}
