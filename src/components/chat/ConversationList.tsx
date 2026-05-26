/**
 * Conversation list component for ZoteroSeek
 * Displays conversation history with switch, rename, and delete capabilities
 */

import React, { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import type { ConversationMeta } from '@/typings';
import { XulButton } from '@/components/common/XulButton';
import { Icon } from '@/components/common/Icon';

interface ConversationListProps {
  /** Callback when a conversation is selected */
  onSelect?: (id: string) => void;
}

/**
 * Format timestamp to relative time or date string
 */
function formatTime(date: Date): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

/** Group label for conversations */
function TimeGroupLabel({ label }: { label: string }) {
  return (
    <div className="text-[11px] text-[#888] px-3 py-2">
      {label}
    </div>
  );
}

/**
 * Single conversation item component
 */
interface ConversationItemProps {
  conversation: ConversationMeta;
  isActive: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const [showConfirm, setShowConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    setEditTitle(conversation.title);
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(conversation.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditTitle(conversation.title);
    }
  };

  const handleDelete = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setShowConfirm(true);
  };

  const confirmDelete = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    onDelete(conversation.id);
    setShowConfirm(false);
  };

  const cancelDelete = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setShowConfirm(false);
  };

  return (
    <div
      className={`group relative flex items-center h-9 px-3 text-[13px] rounded-lg mx-2 cursor-pointer transition-colors ${
        isActive
          ? 'bg-[rgba(91,127,255,0.12)] text-[#5B7FFF]'
          : 'hover:bg-white/[0.04] text-[#ececec]'
      }`}
      onClick={() => onSelect(conversation.id)}
      onDoubleClick={handleDoubleClick}
    >
      {/* Title and time */}
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full bg-white border border-blue-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <p className="truncate text-[13px]">{conversation.title}</p>
          </>
        )}
      </div>

      {/* Action buttons */}
      {!isEditing && (
        <div className="ml-2 flex flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <XulButton
            onClick={handleDelete}
            className="rounded p-1 text-[#888] hover:text-red-400"
            title="Delete"
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
          </XulButton>
        </div>
      )}

      {/* Delete confirmation popover */}
      {showConfirm && (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-white/[0.06] bg-[#1f1f23] p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-2 text-xs text-[#ececec]">Delete this conversation?</p>
          <div className="flex space-x-2">
            <XulButton
              onClick={confirmDelete}
              className="flex-1 rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600"
            >
              Delete
            </XulButton>
            <XulButton
              onClick={cancelDelete}
              className="flex-1 rounded border border-white/[0.06] px-2 py-1 text-xs text-[#888] hover:bg-white/[0.04]"
            >
              Cancel
            </XulButton>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Conversation list component
 * Displays all conversations with ability to switch, rename, and delete
 */
export function ConversationList({ onSelect }: ConversationListProps) {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const addConversation = useChatStore((s) => s.addConversation);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const handleSelect = async (id: string) => {
    await setCurrentConversation(id);
    onSelect?.(id);
  };

  const handleNewConversation = async () => {
    const id = await addConversation();
    onSelect?.(id);
  };

  const handleRename = async (id: string, title: string) => {
    await renameConversation(id, title);
  };

  const handleDelete = async (id: string) => {
    await deleteConversation(id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* New conversation button */}
      <button
        onClick={handleNewConversation}
        className="mx-3 mt-3 mb-2 border border-white/[0.06] rounded-lg px-3 py-2 text-[13px] text-[#888] hover:bg-white/[0.04] w-full text-left transition-colors"
      >
        + New conversation
      </button>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Icon name="chat" className="mx-auto mb-3 h-10 w-10 text-[#888]" />
              <p className="text-xs text-[#888]">No conversations yet</p>
            </div>
          </div>
        ) : (
          <div>
            <TimeGroupLabel label="Today" />
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === currentConversationId}
                onSelect={handleSelect}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
