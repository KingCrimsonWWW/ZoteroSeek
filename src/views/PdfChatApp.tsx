/**
 * PdfChatApp - React entry for the standalone PDF chat window
 *
 * This component renders inside a separate Zotero window opened via
 * window.openDialog(). It loads the full PDF chat UI including
 * PDF selection and AI-powered conversation.
 */

import React from 'react';
import { PdfChatPanel } from '@/components/pdf-chat/PdfChatPanel';
import './styles/globals.css';

export function PdfChatApp() {
  return (
    <div className="h-screen w-screen bg-white">
      <PdfChatPanel />
    </div>
  );
}
