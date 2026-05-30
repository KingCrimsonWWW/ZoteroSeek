// index.ts - Addon entry point
// Wires launcher and bridge modules to global scope for bootstrap.js

declare var _globalThis: any

import { launcher } from './launcher'
import { bridge } from './bridge'
import { registerPrefsScripts } from './settings/preferences'

let isInitialized = false

const addon = {
  hooks: {
    onStartup: () => {
      // Prevent duplicate initialization
      if (isInitialized) return
      isInitialized = true
      
      // Register preference pane
      Zotero.PreferencePanes.register({
        pluginID: 'zoteroseek@kingcrimsonwww.github.io',
        src: 'chrome://zoteroseek/content/preferences.xhtml',
        label: 'ZoteroSeek',
        image: 'chrome://zoteroseek/content/icons/icon.png',
      })
      
      // Add toolbar button to main toolbar
      const doc = Zotero.getMainWindow().document
      if (!doc.getElementById('zotero-tb-zoteroseek')) {
        // Find the advanced button (gear icon) and insert after it
        const advancedBtn = doc.getElementById('zotero-tb-advanced')
        if (advancedBtn) {
          const button = doc.createXULElement('toolbarbutton')
          button.setAttribute('id', 'zotero-tb-zoteroseek')
          button.setAttribute('class', 'zotero-tb-button')
          button.setAttribute('tooltiptext', 'ZoteroSeek - Open AI Assistant')
          button.setAttribute('image', 'chrome://zoteroseek/content/icons/icon.png')
          button.addEventListener('command', () => {
            launcher.openUI()
          })
          advancedBtn.parentNode.insertBefore(button, advancedBtn.nextSibling)
        }
      }
      
      launcher.start()
    },
    onShutdown: () => {
      isInitialized = false
      launcher.stop()
    },
    onPrefsEvent: (type: string, data: { window: Window }) => {
      if (type === 'load') {
        registerPrefsScripts(data.window)
      }
    },
  },
  data: { launcher, bridge },
}

// Expose to Zotero bootstrap.js
_globalThis.addon = addon
Zotero['ZoteroSeek'] = addon

export default addon
