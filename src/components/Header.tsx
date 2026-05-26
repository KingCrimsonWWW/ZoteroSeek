/**
 * Header component for ZoteroSeek panel
 */

import React from 'react';
import { XulButton } from '@/components/common/XulButton';
import { Icon } from '@/components/common/Icon';

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
        <Icon name="logo" className="h-5 w-5" />
        <span className="font-semibold">ZoteroSeek</span>
      </div>

      <div className="flex items-center space-x-1">
        {/* Sidebar toggle */}
        {onToggleSidebar && (
          <XulButton
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSidebar();
            }}
            className={`rounded-full p-1 hover:bg-white/20 ${isSidebarOpen ? 'bg-white/20' : ''}`}
            title="Toggle Conversations"
          >
            <Icon name="menu" className="h-4 w-4" />
          </XulButton>
        )}

        {/* Knowledge toggle */}
        {onToggleKnowledge && (
          <XulButton
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleKnowledge();
            }}
            className={`rounded-full p-1 hover:bg-white/20 ${isKnowledgeOpen ? 'bg-white/20' : ''}`}
            title="Knowledge Base"
          >
            <Icon name="book" className="h-4 w-4" />
          </XulButton>
        )}

        {/* Settings toggle */}
        {onToggleSettings && (
          <XulButton
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSettings();
            }}
            className={`rounded-full p-1 hover:bg-white/20 ${isSettingsOpen ? 'bg-white/20' : ''}`}
            title="Settings"
          >
            <Icon name="gear" className="h-4 w-4" />
          </XulButton>
        )}

        {/* Close button */}
        <XulButton
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="rounded-full p-1 hover:bg-white/20"
          title="Close"
        >
          <Icon name="close" className="h-4 w-4" />
        </XulButton>
      </div>
    </div>
  );
}
