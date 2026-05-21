/**
 * Main container component for ZoteroSeek
 *
 * This is the root React component that renders the chat interface.
 */

import React, { useState, useCallback } from 'react';
import { ChatPanel } from '../components/chat/ChatPanel';
import { ConversationList } from '../components/chat/ConversationList';
import { SettingsPanel } from '../components/settings/SettingsPanel';
import { Header } from '../components/Header';
import { useDragging } from '../hooks/useDragging';
import './styles/globals.css';

export function Container() {
  const [isOpen, setIsOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { isDragging, position, handleMouseDown } = useDragging();

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const toggleSettings = useCallback(() => {
    setIsSettingsOpen((prev) => !prev);
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed z-50 flex h-[600px] w-[600px] flex-col rounded-xl bg-gradient-to-br from-blue-50 to-purple-50 shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {/* Header with drag handle */}
      <Header
        onMouseDown={handleMouseDown}
        onClose={togglePanel}
        onToggleSidebar={toggleSidebar}
        onToggleSettings={toggleSettings}
        isDragging={isDragging}
        isSidebarOpen={isSidebarOpen}
        isSettingsOpen={isSettingsOpen}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Conversation List */}
        {isSidebarOpen && (
          <div className="w-[200px] flex-shrink-0 border-r border-gray-200 bg-white/80">
            <ConversationList />
          </div>
        )}

        {/* Main panel - Chat or Settings */}
        <div className="flex-1 overflow-hidden">
          {isSettingsOpen ? <SettingsPanel /> : <ChatPanel />}
        </div>
      </div>
    </div>
  );
}
