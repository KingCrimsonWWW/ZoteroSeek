/**
 * Locale/i18n utilities for ZoteroSeek
 */

import { config } from '../../package.json';

/**
 * Get a localized string
 */
export function getString(name: string, params?: string[] | Record<string, string>): string {
  try {
    const prefix = config.addonRef;
    const key = `${prefix}.${name}`;

    if (params) {
      return Zotero.getString(key, params);
    }
    return Zotero.getString(key);
  } catch {
    // Fallback to the string name if localization fails
    return name;
  }
}

/**
 * Initialize locale system
 */
export function initLocale(): void {
  const locale = Zotero.Prefs.get('general.useragent.locale') as string || 'en-US';
  console.log(`Locale initialized: ${locale}`);
}
