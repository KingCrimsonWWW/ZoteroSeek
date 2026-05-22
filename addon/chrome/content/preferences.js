/**
 * ZoteroSeek - Preferences pane initialization
 *
 * Handles reading/writing Zotero.Prefs for the native preferences pane.
 * Loaded via <html:script src="chrome://zoteroseek/content/preferences.js"/>
 * in the XHTML fragment. Self-executing — no external init call needed.
 *
 * All settings are stored as a JSON blob under:
 *   extensions.zotero.zoteroseek.model.currentConfig
 *
 * This matches the storage format used by the React SettingsPanel (modelStore.ts),
 * so changes from either UI are reflected in both.
 *
 * NOTE: This file runs in the preferences pane's XUL window context, NOT
 * as an ES module. Zotero.Prefs is available globally.
 */

'use strict';

var PREFS_KEY = 'extensions.zotero.zoteroseek.model.currentConfig';

/**
 * Initialize the preferences pane.
 * Self-executing — runs when the script loads in the preferences window.
 */
(function initPrefs() {
  try {
    var doc = document;
    var apiKeyField = doc.getElementById('zoteroseek-api-key');
    var modelField = doc.getElementById('zoteroseek-model');
    var baseUrlField = doc.getElementById('zoteroseek-base-url');

    // Guard: skip if fields don't exist yet
    if (!apiKeyField && !modelField && !baseUrlField) return;

    loadConfig();

    if (apiKeyField) { apiKeyField.addEventListener('change', saveConfig); }
    if (modelField) { modelField.addEventListener('change', saveConfig); }
    if (baseUrlField) { baseUrlField.addEventListener('change', saveConfig); }

    /** Read current prefs and populate form fields */
    function loadConfig() {
      try {
        var raw = Zotero.Prefs.get(PREFS_KEY, true);
        if (raw) {
          var config = JSON.parse(raw);
          if (apiKeyField) { apiKeyField.value = config.apiKey || ''; }
          if (modelField) { modelField.value = config.model || ''; }
          if (baseUrlField) { baseUrlField.value = config.baseUrl || ''; }
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
        if (raw) { currentConfig = JSON.parse(raw); }
        currentConfig.apiKey = apiKeyField ? apiKeyField.value : '';
        currentConfig.model = modelField ? modelField.value : '';
        currentConfig.baseUrl = baseUrlField ? baseUrlField.value || undefined : undefined;
        Zotero.Prefs.set(PREFS_KEY, JSON.stringify(currentConfig), true);
      } catch (e) {
        Zotero.log('[ZoteroSeek] Failed to save preferences: ' + e, 'error');
      }
    }
  } catch (e) {
    Zotero.log('[ZoteroSeek] Error initializing preferences: ' + e, 'error');
  }
})();
