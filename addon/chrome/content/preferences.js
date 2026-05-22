/**
 * ZoteroSeek - Preferences pane initialization
 *
 * Loaded via <html:script> in preferences.xhtml.
 * Reads/writes Zotero.Prefs for API Key, Model, and Base URL.
 */
'use strict';

(function () {
  try {
    var PREFS_KEY = 'extensions.zotero.zoteroseek.model.currentConfig';
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

    function loadConfig() {
      var raw = Zotero.Prefs.get(PREFS_KEY, true);
      if (raw) {
        var config = JSON.parse(raw);
        if (apiKeyField) apiKeyField.value = config.apiKey || '';
        if (modelField) modelField.value = config.model || '';
        if (baseUrlField) baseUrlField.value = config.baseUrl || '';
      }
    }

    function saveConfig() {
      var currentConfig = {};
      var raw = Zotero.Prefs.get(PREFS_KEY, true);
      if (raw) {
        currentConfig = JSON.parse(raw);
      }
      currentConfig.apiKey = apiKeyField ? apiKeyField.value : '';
      currentConfig.model = modelField ? modelField.value : '';
      currentConfig.baseUrl = baseUrlField ? baseUrlField.value || undefined : undefined;
      Zotero.Prefs.set(PREFS_KEY, JSON.stringify(currentConfig), true);
    }
  } catch (e) {
    // Silently ignore — Zotero.Prefs may not be available in all contexts
  }
})();
