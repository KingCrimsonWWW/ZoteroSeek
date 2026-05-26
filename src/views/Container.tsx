/**
 * Main container component for ZoteroSeek
 *
 * Three-section layout: Header → body row (Sidebar + Chat) → Input
 * Dark theme using zs-* design tokens.
 */

import React, { useState, useCallback } from 'react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ConversationList } from '@/components/chat/ConversationList';
import { KnowledgePanel } from '@/components/knowledge/KnowledgePanel';
import { Header } from '@/components/Header';
import './styles/globals.css';

type ActiveView = 'chat' | 'knowledge';

interface ContainerProps {
  onContainerHide?: () => void;
}

export function Container({ onContainerHide }: ContainerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<ActiveView>('chat');

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
    <div className="flex h-full w-full flex-col bg-zs-bg-primary text-zs-text-primary overflow-hidden">
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
          <div className="w-[280px] flex-shrink-0 border-r border-zs-border bg-zs-bg-sidebar">
            <ConversationList />
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-h-0 bg-zs-bg-primary">
          {activeView === 'knowledge' ? <KnowledgePanel /> : <ChatPanel />}
        </div>
      </div>
    </div>
  );
}
