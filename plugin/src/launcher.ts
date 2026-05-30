// launcher.ts - Start/stop backend and open browser

import { getPref } from './utils/prefs';

function getBackendUrl(): string {
  const url = getPref('url') || 'http://localhost';
  const port = getPref('port') || 20801;
  return `${url}:${port}`;
}

export const launcher = {
  process: null as { kill(): void } | null,
  
  async start() {
    Zotero.log('[ZoteroSeek] Starting backend...');
    
    // Check if backend is already running
    try {
      const response = await fetch(`${getBackendUrl()}/api/v1/health`);
      if (response.ok) {
        Zotero.log('[ZoteroSeek] Backend already running');
        this.openUI();
        return;
      }
    } catch (e) {
      // Backend not running, start it
    }
    
    // Start backend process
    // Note: In real Zotero plugin, use nsIProcess or child_process
    Zotero.log('[ZoteroSeek] Backend needs to be started manually');
    Zotero.log(`[ZoteroSeek] Run: cd backend && python main.py`);
    
    // Open UI after delay
    setTimeout(() => this.openUI(), 2000);
  },
  
  stop() {
    Zotero.log('[ZoteroSeek] Stopping...');
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  },
  
  openUI() {
    // Open browser to backend URL using Zotero API
    Zotero.log(`[ZoteroSeek] Opening UI: ${getBackendUrl()}`);
    try {
      const win = Zotero.getMainWindow();
      if (win) {
        // Zotero 9 uses Zotero.launchURL or window.open
        Zotero.launchURL(getBackendUrl());
      } else {
        Zotero.log('[ZoteroSeek] No main window available');
      }
    } catch (e) {
      Zotero.log(`[ZoteroSeek] Error opening UI: ${e}`);
    }
  },
};
