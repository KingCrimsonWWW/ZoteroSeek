/* eslint-disable no-undef */

var chromeHandle

function install(data, reason) { }

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise
  if (!rootURI) {
    rootURI = resourceURI.spec
  }

  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup)
  var manifestURI = Services.io.newURI(rootURI + "manifest.json")
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "chrome/content/"],
  ])

  const ctx = {
    rootURI,
  }
  ctx._globalThis = ctx

  Services.scriptloader.loadSubScript(
    `${rootURI}/chrome/content/scripts/__addonRef__.js`,
    ctx,
  )
  Zotero.__addonInstance__.hooks.onStartup()
}

async function onMainWindowLoad({ window }, reason) {
  Zotero.log('[ZoteroSeek] bootstrap onMainWindowLoad called')
  if (Zotero.__addonInstance__?.hooks?.onMainWindowLoad) {
    Zotero.__addonInstance__.hooks.onMainWindowLoad(window)
  }
}

async function onMainWindowUnload({ window }, reason) {
  if (Zotero.__addonInstance__?.hooks?.onMainWindowUnload) {
    Zotero.__addonInstance__.hooks.onMainWindowUnload(window)
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return
  }
  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports
    ).wrappedJSObject
  }
  Zotero.__addonInstance__?.hooks.onShutdown()

  try {
    Cc["@mozilla.org/intl/stringbundle;1"]
      .getService(Components.interfaces.nsIStringBundleService)
      .flushBundles()
  } catch (e) {
    // Ignore errors during shutdown
  }

  // Cu.unload is deprecated in Zotero 9
  try {
    if (typeof Cu.unload === 'function') {
      Cu.unload(`${rootURI}/chrome/content/scripts/__addonRef__.js`)
    }
  } catch (e) {
    // Ignore unload errors
  }

  if (chromeHandle) {
    chromeHandle.destruct()
    chromeHandle = null
  }
}

function uninstall(data, reason) { }
