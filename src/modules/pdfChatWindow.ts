/**
 * PDF Chat Window Manager
 *
 * Manages the lifecycle of the standalone PDF chat window:
 * - Opens a new Zotero window via window.openDialog()
 * - Loads React and PdfChatApp into the window asynchronously
 * - Prevents duplicate window opens
 * - Handles cleanup on window close
 */

// Track the open window reference to prevent duplicates
let pdfChatWindow: Window | null = null;

/**
 * Copy all <style> elements from the main document into the target window's document.
 * This ensures Tailwind CSS (and other styles) are available in the PDF chat window.
 */
function injectStylesIntoTargetWindow(targetDoc: Document): void {
  const mainStyles = document.querySelectorAll('style');
  mainStyles.forEach((style) => {
    const clone = targetDoc.createElement('style');
    clone.textContent = style.textContent;
    targetDoc.head.appendChild(clone);
  });
}

/**
 * Load React app asynchronously into the PDF chat window.
 * Follows the same pattern as addonHooks.ts loadReactApp().
 */
async function loadReactIntoWindow(win: Window): Promise<void> {
  try {
    Zotero.log('[ZoteroSeek] Loading PDF chat React app...');

    const { createRoot } = await import('react-dom/client');
    const React = await import('react');
    const { PdfChatApp } = await import('../views/PdfChatApp');

    const doc = win.document;

    // Inject Tailwind CSS from main document into the PDF chat window
    injectStylesIntoTargetWindow(doc);

    const rootEl = doc.getElementById('zoteroseek-pdf-chat-root');
    if (!rootEl) {
      Zotero.log('[ZoteroSeek] PDF chat root element not found');
      return;
    }

    const root = createRoot(rootEl);
    root.render(React.createElement(PdfChatApp));

    Zotero.log('[ZoteroSeek] PDF chat React app loaded successfully');
  } catch (error) {
    Zotero.log(`[ZoteroSeek] Error loading PDF chat React app: ${error}`);
  }
}

/**
 * Open the standalone PDF chat window.
 *
 * Uses window.openDialog() to open a new Zotero window that loads
 * chrome://zoteroseek/content/pdf-chat.xhtml. If a window is already
 * open, it focuses the existing one instead of opening a duplicate.
 */
export async function openPdfChatWindow(): Promise<void> {
  // If window is already open, just focus it
  if (pdfChatWindow && !pdfChatWindow.closed) {
    pdfChatWindow.focus();
    Zotero.log('[ZoteroSeek] PDF chat window already open, focused existing');
    return;
  }

  Zotero.log('[ZoteroSeek] Opening PDF chat window...');

  // window.openDialog() is a Mozilla-specific API available in Zotero's
  // privileged context (not in standard DOM types, hence the type assertion)
  pdfChatWindow = (window as any).openDialog(
    'chrome://zoteroseek/content/pdf-chat.xhtml',
    'zoteroseek-pdf-chat',
    'chrome,resizable,centerscreen,width=800,height=600',
  );

  if (!pdfChatWindow) {
    Zotero.log('[ZoteroSeek] Failed to open PDF chat window');
    return;
  }

  // Render React app when the window finishes loading.
  // Handle the edge case where the window is already loaded by the
  // time this listener is attached.
  const startRender = () => loadReactIntoWindow(pdfChatWindow!);

  if (pdfChatWindow.document.readyState === 'complete') {
    startRender();
  } else {
    pdfChatWindow.addEventListener('load', startRender, { once: true });
  }

  // Clean up reference when the window is closed
  pdfChatWindow.addEventListener(
    'unload',
    () => {
      pdfChatWindow = null;
      Zotero.log('[ZoteroSeek] PDF chat window closed');
    },
    { once: true },
  );
}
