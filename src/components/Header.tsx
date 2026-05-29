/**
 * Header component for ZoteroSeek panel
 * Compact restrained header (56px) with frosted glass effect.
 */

import React from 'react';
import { XulButton } from '@/components/common/XulButton';
import { Icon } from '@/components/common/Icon';
import { useTheme } from '@/hooks/useTheme';

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
  const { dark, toggle } = useTheme();

  return (
    <div className={`flex h-14 items-center justify-between backdrop-blur-md border-b px-4 ${dark ? 'bg-[rgba(18,18,18,0.85)] border-white/[0.06]' : 'bg-[rgba(255,255,255,0.9)] border-black/[0.08]'}`}>
      <div className="flex items-center gap-2">
        <Icon name="logo" className="h-5 w-5" dark={dark} />
        <span className={`text-sm font-semibold ${dark ? 'text-[#ececec]' : 'text-[#1a1a1e]'}`}>ZoteroSeek</span>
        <span className="ml-2 text-[10px] text-[#5B7FFF]">AI Ready</span>
      </div>

      <div className="flex items-center gap-0.5">
        {/* Sidebar toggle */}
        {onToggleSidebar && (
          <XulButton
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSidebar();
            }}
            className={`h-8 w-8 rounded-lg transition-colors ${dark ? 'text-[#888] hover:text-[#ececec] hover:bg-white/[0.04]' : 'text-[#666] hover:text-[#1a1a1e] hover:bg-black/[0.04]'} ${isSidebarOpen ? 'text-[#5B7FFF]' : ''}`}
            title="Toggle Conversations"
          >
            <Icon name="menu" className="h-[18px] w-[18px]" dark={dark} />
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
            className={`h-8 w-8 rounded-lg transition-colors ${dark ? 'text-[#888] hover:text-[#ececec] hover:bg-white/[0.04]' : 'text-[#666] hover:text-[#1a1a1e] hover:bg-black/[0.04]'} ${isKnowledgeOpen ? 'text-[#5B7FFF]' : ''}`}
            title="Knowledge Base"
          >
            <Icon name="book" className="h-[18px] w-[18px]" dark={dark} />
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
            className={`h-8 w-8 rounded-lg transition-colors ${dark ? 'text-[#888] hover:text-[#ececec] hover:bg-white/[0.04]' : 'text-[#666] hover:text-[#1a1a1e] hover:bg-black/[0.04]'}`}
            title="Settings"
          >
            <Icon name="gear" className="h-[18px] w-[18px]" dark={dark} />
          </XulButton>
        )}

        {/* Dark/Light mode toggle */}
        <XulButton
          onClick={toggle}
          className={`h-8 w-8 rounded-lg transition-colors ${dark ? 'text-[#888] hover:text-[#ececec] hover:bg-white/[0.04]' : 'text-[#666] hover:text-[#1a1a1e] hover:bg-black/[0.04]'}`}
          title={dark ? 'Light Mode' : 'Dark Mode'}
        >
          <Icon name={dark ? 'sun' : 'moon'} className="h-[18px] w-[18px]" dark={dark} />
        </XulButton>

        {/* Close button */}
        <XulButton
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={`h-8 w-8 rounded-lg transition-colors ${dark ? 'text-[#888] hover:text-[#ececec] hover:bg-white/[0.04]' : 'text-[#666] hover:text-[#1a1a1e] hover:bg-black/[0.04]'}`}
          title="Close"
        >
          <Icon name="close" className="h-[18px] w-[18px]" dark={dark} />
        </XulButton>
      </div>
    </div>
  );
}
