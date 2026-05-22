/**
 * ZoteroSeek - Preferences pane initialization
 *
 * Handles reading/writing Zotero.Prefs for the native preferences pane.
 * Loaded via the `scripts` parameter in Zotero.PreferencePanes.register().
 *
 * All settings are stored as a JSON blob under:
 *   extensions.zotero.zoteroseek.model.currentConfig
 *
 * This matches the storage format used by the React SettingsPanel (modelStore.ts),
 * so changes from either UI are reflected in both.
 *
 * NOTE: This file runs in the preferences pane's XUL window context, NOT
 * as an ES module. Zotero.Prefs is available globally.
 * The `initPrefs` function is called by Zotero when the pane is loaded.
 */

'use strict';

var PREFS_KEY = 'extensions.zotero.zoteroseek.model.currentConfig';

/**
 * Initialize the preferences pane.
 * Called by Zotero when the pane is loaded.
 * @param {Window} window - The preferences pane window
 */
function initPrefs(window) {
  var doc = window.document;

  var apiKeyField = doc.getElementById('zoteroseek-api-key');
  var modelField = doc.getElementById('zoteroseek-model');
  var baseUrlField = doc.getElementById('zoteroseek-base-url');

  loadConfig();

  if (apiKeyField) {
    apiKeyField.addEventListener('change', saveConfig);
  }
  if (modelField) {
    modelField.addEventListener('change', saveConfig);
  }
  if (baseUrlField) {
    baseUrlField.addEventListener('change', saveConfig);
  }

  /** Read current prefs and populate form fields */
  function loadConfig() {
    try {
      var raw = Zotero.Prefs.get(PREFS_KEY, true);
      if (raw) {
        var config = JSON.parse(raw);
        if (apiKeyField) {
          apiKeyField.value = config.apiKey || '';
        }
        if (modelField) {
          modelField.value = config.model || '';
        }
        if (baseUrlField) {
          baseUrlField.value = config.baseUrl || '';
        }
      }
    } catch (e) {
      Zotero.log('[ZoteroSeek] Failed to load preferences: ' + e, 'error');
    }
  }

  /** Read form fields, merge with existing config, and write to prefs */
  function saveConfig() {
    try {
      // Preserve existing fields not shown in form (e.g. provider)
      var currentConfig = {};
      var raw = Zotero.Prefs.get(PREFS_KEY, true);
      if (raw) {
        currentConfig = JSON.parse(raw);
      }

      currentConfig.apiKey = apiKeyField ? apiKeyField.value : '';
      currentConfig.model = modelField ? modelField.value : '';
      currentConfig.baseUrl = baseUrlField
        ? baseUrlField.value || undefined
        : undefined;

      Zotero.Prefs.set(PREFS_KEY, JSON.stringify(currentConfig), true);
    } catch (e) {
      Zotero.log('[ZoteroSeek] Failed to save preferences: ' + e, 'error');
    }
  }
}
