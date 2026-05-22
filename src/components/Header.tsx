/**
 * Header component for ZoteroSeek panel
 */

import React from 'react';

interface HeaderProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onClose: () => void;
  onToggleSidebar?: () => void;
  onToggleSettings?: () => void;
  onToggleKnowledge?: () => void;
  isDragging: boolean;
  isSidebarOpen?: boolean;
  isSettingsOpen?: boolean;
  isKnowledgeOpen?: boolean;
}

export function Header({
  onMouseDown,
  onClose,
  onToggleSidebar,
  onToggleSettings,
  onToggleKnowledge,
  isDragging,
  isSidebarOpen,
  isSettingsOpen,
  isKnowledgeOpen,
}: HeaderProps) {
  return (
    <div
      className={`flex cursor-move items-center justify-between bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-3 text-white ${
        isDragging ? 'opacity-80' : ''
      }`}
      onMouseDown={onMouseDown}
    >
      <div className="flex items-center space-x-2">
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        <span className="font-semibold">ZoteroSeek</span>
      </div>

      <div className="flex items-center space-x-1">
        {/* Sidebar toggle */}
        {onToggleSidebar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSidebar();
            }}
            className={`rounded-full p-1 hover:bg-white/20 ${isSidebarOpen ? 'bg-white/20' : ''}`}
            title="Toggle Conversations"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        {/* Knowledge toggle */}
        {onToggleKnowledge && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleKnowledge();
            }}
            className={`rounded-full p-1 hover:bg-white/20 ${isKnowledgeOpen ? 'bg-white/20' : ''}`}
            title="Knowledge Base"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </button>
        )}

        {/* Settings toggle */}
        {onToggleSettings && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSettings();
            }}
            className={`rounded-full p-1 hover:bg-white/20 ${isSettingsOpen ? 'bg-white/20' : ''}`}
            title="Settings"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="rounded-full p-1 hover:bg-white/20"
          title="Close"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
