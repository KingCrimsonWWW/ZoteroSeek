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
      // 策略：尝试多个锚点 ID，兼容不同 Zotero 版本
      const doc = Zotero.getMainWindow().document
      if (!doc.getElementById('zotero-tb-zoteroseek')) {
        // 尝试多个锚点按钮，优先放在"新建条目/新建笔记"同一工具栏
        const anchorIds = ['zotero-tb-note-add', 'zotero-tb-add', 'zotero-tb-advanced', 'zotero-tb-sync']
        let anchorBtn: Element | null = null
        for (const id of anchorIds) {
          anchorBtn = doc.getElementById(id)
          if (anchorBtn) break
        }

        if (anchorBtn) {
          const button = doc.createXULElement('toolbarbutton')
          button.setAttribute('id', 'zotero-tb-zoteroseek')
          button.setAttribute('class', 'zotero-tb-button')
          button.setAttribute('tooltiptext', 'ZoteroSeek - Open AI Assistant')
          button.setAttribute('image', 'chrome://zoteroseek/content/icons/icon.png')

          // 同时注册 command 和 click 事件，确保兼容性
          const handler = () => { launcher.openUI() }
          button.addEventListener('command', handler)
          button.addEventListener('click', handler)

          anchorBtn.parentNode!.insertBefore(button, anchorBtn.nextSibling)
          Zotero.log('[ZoteroSeek] Toolbar button added')
        } else {
          Zotero.log('[ZoteroSeek] WARNING: No anchor button found, toolbar button not added')
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
// 关键：必须设置 Zotero.__addonInstance__，否则 bootstrap.js 无法调用 hooks
// _globalThis.addon 是沙盒内部引用，bootstrap.js 通过 Zotero.__addonInstance__ 访问
_globalThis.addon = addon
Zotero.__addonInstance__ = addon
Zotero['ZoteroSeek'] = addon

export default addon
