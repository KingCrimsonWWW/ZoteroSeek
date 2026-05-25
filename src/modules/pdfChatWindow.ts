/**
 * PDF Chat Window Manager
 *
 * Manages the lifecycle of the standalone PDF chat window:
 * - Opens popup.xhtml via Zotero.getMainWindow().openDialog()
 * - Mounts React PdfChatApp into the shared #zoteroseek-entry-point
 * - Passes PDF item info via windowArgs
 * - Prevents duplicate window opens
 * - Handles cleanup on window close (dialogclosing + unload)
 */

import { config } from '../../package.json';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PdfChatApp } from '../views/PdfChatApp';

// Track the open window reference to prevent duplicates
let pdfChatWindow: Window | null = null;
let reactRoot: ReturnType<typeof createRoot> | undefined;

/** PDF item info passed from the context menu */
export interface PdfItemInfo {
  id: number;
  title?: string;
}

/**
 * Open the standalone PDF chat window.
 *
 * Uses Zotero.getMainWindow().openDialog() with popup.xhtml,
 * following the same pattern as ReactRoot.launchApp().
 * Passes PDF item info via windowArgs.
 *
 * If a window is already open, it focuses the existing one.
 */
export async function openPdfChatWindow(pdfItem?: PdfItemInfo): Promise<void> {
  // If window is already open, just focus it
  if (pdfChatWindow && !pdfChatWindow.closed) {
    pdfChatWindow.focus();
    Zotero.log('[ZoteroSeek] PDF chat window already open, focused existing');
    return;
  }

  Zotero.log('[ZoteroSeek] Opening PDF chat window...');

  const windowArgs = {
    _initPromise: Zotero.Promise.defer(),
    pdfItem: pdfItem || null,
  };

  const win = Zotero.getMainWindow();

  pdfChatWindow = (win as any).openDialog(
    `chrome://${config.addonRef}/content/popup.xhtml`,
    'zoteroseek-pdf-chat',
    'chrome,resizable,centerscreen,width=800,height=600',
    windowArgs,
  );

  if (!pdfChatWindow) {
    Zotero.log('[ZoteroSeek] Failed to open PDF chat window');
    return;
  }

  // Mount React on dialog load
  pdfChatWindow.addEventListener(
    'load',
    () => {
      const entry = pdfChatWindow!.document.getElementById(
        'zoteroseek-entry-point',
      );
      if (entry) {
        const root = createRoot(entry);
        reactRoot = root;
        root.render(React.createElement(PdfChatApp));
        Zotero.log('[ZoteroSeek] PDF chat React app mounted');
      }
    },
    { once: true },
  );

  // Cleanup React root on dialog close
  pdfChatWindow.addEventListener(
    'dialogclosing',
    () => {
      if (reactRoot) {
        reactRoot.unmount();
        reactRoot = undefined;
      }
      Zotero.log('[ZoteroSeek] PDF chat window closing');
    },
    { once: true },
  );

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
