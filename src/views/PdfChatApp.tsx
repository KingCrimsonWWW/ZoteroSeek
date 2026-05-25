/**
 * PdfChatApp - React entry for the standalone PDF chat window
 *
 * This component renders inside a separate Zotero window opened via
 * openDialog(). It reads PDF item info from window.arguments
 * (passed by openPdfChatWindow) and renders the PdfChatPanel.
 */

import React from 'react';
import { PdfChatPanel } from '@/components/pdf-chat/PdfChatPanel';
import { createLogger } from '@/utils/logger';
import './styles/globals.css';

const logger = createLogger('PdfChatApp');

export function PdfChatApp() {
  // Read PDF item info from windowArgs (set by openPdfChatWindow)
  const pdfItem = (window as any).arguments?.[0]?.pdfItem;

  if (pdfItem) {
    logger.info('PDF chat window opened with pre-selected item', {
      id: pdfItem.id,
      title: pdfItem.title,
    });
  }

  return (
    <div className="h-screen w-screen bg-white">
      <PdfChatPanel />
    </div>
  );
}
