/**
 * Main container component for ZoteroSeek
 *
 * This is the root React component that renders the chat interface.
 */

import React, { useState, useCallback } from 'react';
import { ChatPanel } from '../components/chat/ChatPanel';
import { Header } from '../components/Header';
import { useDragging } from '../hooks/useDragging';

export function Container() {
  const [isOpen, setIsOpen] = useState(true);
  const { isDragging, position, handleMouseDown } = useDragging();

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed z-50 flex h-[600px] w-[400px] flex-col rounded-xl bg-gradient-to-br from-blue-50 to-purple-50 shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {/* Header with drag handle */}
      <Header
        onMouseDown={handleMouseDown}
        onClose={togglePanel}
        isDragging={isDragging}
      />

      {/* Main chat area */}
      <div className="flex-1 overflow-hidden">
        <ChatPanel />
      </div>
    </div>
  );
}
