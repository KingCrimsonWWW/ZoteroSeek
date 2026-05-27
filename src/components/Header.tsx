/**
 * Header component for ZoteroSeek panel
 * Compact restrained header (56px) with frosted glass effect.
 */

import React, { useState, useEffect } from 'react';
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
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.style.setProperty('--bg-primary', '#111113');
      root.style.setProperty('--bg-sidebar', '#18181b');
      root.style.setProperty('--text-primary', '#ececec');
      root.style.setProperty('--text-secondary', '#888888');
      root.style.setProperty('--border', 'rgba(255,255,255,0.06)');
      root.style.setProperty('--accent', '#5B7FFF');
    } else {
      root.style.setProperty('--bg-primary', '#ffffff');
      root.style.setProperty('--bg-sidebar', '#f5f5f5');
      root.style.setProperty('--text-primary', '#1a1a1a');
      root.style.setProperty('--text-secondary', '#666666');
      root.style.setProperty('--border', 'rgba(0,0,0,0.06)');
      root.style.setProperty('--accent', '#4F6FDF');
    }
  }, [darkMode]);

  return (
    <div className="flex h-14 items-center justify-between bg-[rgba(18,18,18,0.85)] backdrop-blur-md border-b border-white/[0.06] px-4">
      <div className="flex items-center gap-2">
        <Icon name="logo" className="h-5 w-5" />
        <span className="text-sm font-semibold text-[#ececec]">ZoteroSeek</span>
        <span className="ml-2 text-[10px] text-[#5B7FFF]">AI Ready</span>
      </div>

      <div className="flex items-center gap-1">
        {/* Sidebar toggle */}
        {onToggleSidebar && (
          <XulButton
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSidebar();
            }}
            className={`h-8 w-8 rounded-lg text-[#888] hover:text-[#ececec] hover:bg-white/[0.04] transition-colors ${isSidebarOpen ? 'text-[#5B7FFF]' : ''}`}
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
            className={`h-8 w-8 rounded-lg text-[#888] hover:text-[#ececec] hover:bg-white/[0.04] transition-colors ${isKnowledgeOpen ? 'text-[#5B7FFF]' : ''}`}
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
            className="h-8 w-8 rounded-lg text-[#888] hover:text-[#ececec] hover:bg-white/[0.04] transition-colors"
            title="Settings"
          >
            <Icon name="gear" className="h-[18px] w-[18px]" />
          </XulButton>
        )}

        {/* Dark/Light mode toggle */}
        <XulButton
          onClick={() => setDarkMode((prev) => !prev)}
          className="h-8 w-8 rounded-lg text-[#888] hover:text-[#ececec] hover:bg-white/[0.04] transition-colors"
          title={darkMode ? 'Light Mode' : 'Dark Mode'}
        >
          <Icon name={darkMode ? 'sun' : 'moon'} className="h-[18px] w-[18px]" />
        </XulButton>

        {/* Close button */}
        <XulButton
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="h-8 w-8 rounded-lg text-[#888] hover:text-[#ececec] hover:bg-white/[0.04] transition-colors"
          title="Close"
        >
          <Icon name="close" className="h-[18px] w-[18px]" />
        </XulButton>
      </div>
    </div>
  );
}
