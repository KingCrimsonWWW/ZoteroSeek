/**
 * Locale/i18n utilities for ZoteroSeek
 *
 * Uses Fluent API (Localization) for translations.
 * FTL files are located at addon/locale/{locale}/addon.ftl
 */

/* eslint-disable no-undef */
import { config } from '../../package.json';

export { initLocale, getString };

/**
 * Initialize locale data by creating a Localization instance.
 * Stores the instance in addon.data.locale.current.
 */
function initLocale(): void {
  const l10n = new (
    typeof Localization === 'undefined'
      ? ztoolkit.getGlobal('Localization')
      : Localization
  )([`${config.addonRef}-addon.ftl`], true);
  addon.data.locale = {
    current: l10n,
  };
}

/**
 * Get a localized string using Fluent API.
 *
 * FTL key format: `${name}` (e.g. `menu-tools`)
 *
 * @param name - The string key (matches FTL file key)
 * @param branchOrOptions - Optional branch name or options object
 * @returns The localized string, or the key as fallback
 */
function getString(
  name: string,
  branchOrOptions?: string | { branch?: string | undefined; args?: Record<string, unknown> },
): string {
  if (typeof branchOrOptions === 'string') {
    return _getString(name, { branch: branchOrOptions });
  } else if (branchOrOptions) {
    return _getString(name, branchOrOptions);
  }
  return _getString(name);
}

/**
 * Internal implementation for getString.
 */
function _getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  const { branch, args } = options;
  const pattern = addon.data.locale?.current.formatMessagesSync([
    { id: localeString, args },
  ])[0];
  if (!pattern) {
    return localeString;
  }
  if (branch && pattern.attributes) {
    return pattern.attributes[branch] || localeString;
  } else {
    return pattern.value || localeString;
  }
}
