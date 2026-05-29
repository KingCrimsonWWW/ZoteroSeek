var ZoteroSeek = {
  id: null,
  version: null,
  rootURI: null,
  
  install(data, reason) {},
  
  async startup({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    
    // Load the bundled script (built by zotero-plugin-scaffold)
    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/scripts/zoteroseek.js');
  },
  
  shutdown({ id, version, rootURI }) {
    if (typeof ZoteroSeek !== 'undefined' && ZoteroSeek.launcher) {
      ZoteroSeek.launcher.stop();
    }
  },
};
