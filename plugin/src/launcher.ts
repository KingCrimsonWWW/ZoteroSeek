// launcher.ts - Start/stop backend and open browser

const BACKEND_PORT = 20801;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

export const launcher = {
  process: null as any,
  
  async start() {
    Zotero.log('[ZoteroSeek] Starting backend...');
    
    // Check if backend is already running
    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/health`);
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
    // Open browser to backend URL
    const uri = Services.io.newURI(BACKEND_URL);
    const handler = Services.ios.getProtocolHandler('http');
    // In real implementation: Zotero.getMainWindow().openUILink(BACKEND_URL);
    Zotero.log(`[ZoteroSeek] Opening UI: ${BACKEND_URL}`);
  },
};
