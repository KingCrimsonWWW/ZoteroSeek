/**
 * ZoteroSeek - Preferences pane initialization
 *
 * Loaded via <html:script> in preferences.xhtml.
 * Reads/writes Zotero.Prefs for API Key, Model, and Base URL.
 *
 * NOTE: This file runs in the preferences pane's XUL window context.
 * Zotero.Prefs is available globally.
 */
'use strict';

var PREFS_KEY = 'extensions.zotero.zoteroseek.model.currentConfig';

(function initPrefs() {
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

  Zotero.log('[ZoteroSeek] Preferences pane loaded');

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
})();
