import { config } from "../../package.json";

/**
 * 获取偏好设置值
 * Zotero.Prefs.get 的封装
 * @param key 配置键名（不含前缀）
 */
export function getPref(key: string) {
  return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true);
}

/**
 * 设置偏好设置值
 * Zotero.Prefs.set 的封装
 * @param key 配置键名（不含前缀）
 * @param value 配置值
 */
export function setPref(key: string, value: string | number | boolean) {
  return Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
}

/**
 * 清除偏好设置值
 * Zotero.Prefs.clear 的封装
 * @param key 配置键名（不含前缀）
 */
export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${config.prefsPrefix}.${key}`, true);
}
