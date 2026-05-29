var ZoteroSeek = {
  id: null,
  version: null,
  rootURI: null,
  
  install(data, reason) {},
  
  async startup({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    
    // Load launcher
    Services.scriptloader.loadSubScript(rootURI + 'src/launcher.js');
    
    // Start backend and open UI
    ZoteroSeek.launcher.start();
  },
  
  shutdown({ id, version, rootURI }) {
    ZoteroSeek.launcher.stop();
  },
};
