/**
 * Header component for ZoteroSeek panel
 * Minimal frosted glass header with accent color.
 */

import React from 'react';
import { XulButton } from '@/components/common/XulButton';
import { Icon } from '@/components/common/Icon';

interface HeaderProps {
  onClose: () => void;
  onToggleSidebar?: () => void;
  onToggleSettings?: () => void;
  onToggleKnowledge?: () => void;
  isSidebarOpen?: boolean;
  isSettingsOpen?: boolean;
  isKnowledgeOpen?: boolean;
}

export function Header({
  onClose,
  onToggleSidebar,
  onToggleSettings,
  onToggleKnowledge,
  isSidebarOpen,
  isKnowledgeOpen,
}: HeaderProps) {
  return (
    <div className="flex h-14 items-center justify-between bg-zs-bg-header backdrop-blur-xl border-b border-zs-border px-4">
      <div className="flex items-center gap-2">
        <Icon name="logo" className="h-5 w-5" />
        <span className="text-sm font-medium text-zs-text-primary">ZoteroSeek</span>
        <span className="ml-2 text-xs text-zs-accent">AI Ready</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Sidebar toggle */}
        {onToggleSidebar && (
          <XulButton
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSidebar();
            }}
            className={`rounded-lg p-1.5 text-zs-text-secondary hover:text-zs-text-primary transition-colors ${isSidebarOpen ? 'text-zs-accent' : ''}`}
            title="Toggle Conversations"
          >
            <Icon name="menu" className="h-[18px] w-[18px]" />
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
            className={`rounded-lg p-1.5 text-zs-text-secondary hover:text-zs-text-primary transition-colors ${isKnowledgeOpen ? 'text-zs-accent' : ''}`}
            title="Knowledge Base"
          >
            <Icon name="book" className="h-[18px] w-[18px]" />
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
            className="rounded-lg p-1.5 text-zs-text-secondary hover:text-zs-text-primary transition-colors"
            title="Settings"
          >
            <Icon name="gear" className="h-[18px] w-[18px]" />
          </XulButton>
        )}

        {/* Close button */}
        <XulButton
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="rounded-lg p-1.5 text-zs-text-secondary hover:text-zs-text-primary transition-colors"
          title="Close"
        >
          <Icon name="close" className="h-[18px] w-[18px]" />
        </XulButton>
      </div>
    </div>
  );
}
