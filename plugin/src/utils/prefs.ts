const PREFS_PREFIX = 'extensions.zotero.zoteroseek';

export function getPref(key: string) {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true);
}

export function setPref(key: string, value: string | number | boolean) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}
