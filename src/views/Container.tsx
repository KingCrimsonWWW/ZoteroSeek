/**
 * Main container component for ZoteroSeek
 *
 * Structured layout: Header → flex-1 row (Sidebar + Chat).
 * Theme-aware with dark/light mode support.
 */

import React, { useState, useCallback } from 'react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ConversationList } from '@/components/chat/ConversationList';
import { KnowledgePanel } from '@/components/knowledge/KnowledgePanel';
import { Header } from '@/components/Header';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import './styles/globals.css';

type ActiveView = 'chat' | 'knowledge';

interface ContainerProps {
  onContainerHide?: () => void;
}

/**
 * Inner content component that reads theme from ThemeProvider context.
 * Separated from Container because useTheme() must be called INSIDE ThemeProvider.
 */
function ContainerContent({ onContainerHide }: ContainerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const { dark } = useTheme();

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (!next && onContainerHide) {
        onContainerHide();
      }
      return next;
    });
  }, [onContainerHide]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const toggleKnowledge = useCallback(() => {
    setActiveView((prev) => (prev === 'knowledge' ? 'chat' : 'knowledge'));
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={`flex h-full w-full flex-col overflow-hidden ${dark ? 'bg-[#111113]' : 'bg-[#ffffff]'}`}>
      {/* Header — fixed at top */}
      <Header
        onClose={togglePanel}
        onToggleSidebar={toggleSidebar}
        onToggleKnowledge={toggleKnowledge}
        isSidebarOpen={isSidebarOpen}
        isKnowledgeOpen={activeView === 'knowledge'}
      />

      {/* Body — sidebar + main content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {isSidebarOpen && (
          <div className={`w-[280px] flex-shrink-0 border-r ${dark ? 'bg-[#18181b] border-white/[0.06]' : 'bg-[#f5f5f5] border-black/[0.08]'}`}>
            <ConversationList />
          </div>
        )}

        {/* Main content */}
        <div className={`flex-1 min-h-0 ${dark ? 'bg-[#111113]' : 'bg-[#ffffff]'}`}>
          {activeView === 'knowledge' ? <KnowledgePanel /> : <ChatPanel />}
        </div>
      </div>
    </div>
  );
}

export function Container({ onContainerHide }: ContainerProps) {
  return (
    <ThemeProvider>
      <ContainerContent onContainerHide={onContainerHide} />
    </ThemeProvider>
  );
}
