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
      className={`group relative flex items-center px-3 py-2 rounded-lg cursor-pointer transition-colors ${
        isActive
          ? 'bg-zs-accent text-white'
          : 'hover:bg-zs-accent-subtle transition-colors text-zs-text-primary'
      }`}
      onClick={() => onSelect(conversation.id)}
      onDoubleClick={handleDoubleClick}
    >
      {/* Conversation icon */}
      <Icon name="chat" className="mr-3 h-4 w-4 flex-shrink-0 opacity-50" />

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
            <p className="truncate text-sm">{conversation.title}</p>
            <p className={`text-xs ${isActive ? 'text-white/70' : 'text-zs-text-secondary'}`}>
              {formatTime(conversation.updatedAt)}
            </p>
          </>
        )}
      </div>

      {/* Action buttons */}
      {!isEditing && (
        <div className="ml-2 flex flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <XulButton
            onClick={handleDelete}
            className="rounded p-1 text-zs-text-secondary hover:text-red-400"
            title="Delete"
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
          </XulButton>
        </div>
      )}

      {/* Delete confirmation popover */}
      {showConfirm && (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-2 text-xs text-gray-600">Delete this conversation?</p>
          <div className="flex space-x-2">
            <XulButton
              onClick={confirmDelete}
              className="flex-1 rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600"
            >
              Delete
            </XulButton>
            <XulButton
              onClick={cancelDelete}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
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
      {/* Header with new conversation button */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-medium text-zs-text-primary">Conversations</h3>
        <XulButton
          onClick={handleNewConversation}
          className="bg-zs-accent text-white rounded-lg px-3 py-2 text-sm w-full hover:opacity-90 transition-opacity"
        >
          <Icon name="plus" className="mr-1 h-3.5 w-3.5" />
          New
        </XulButton>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {conversations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            <div className="text-center">
              <Icon name="chat" className="mx-auto mb-3 h-10 w-10" />
              <p className="text-xs">No conversations yet</p>
            </div>
          </div>
        ) : (
          conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === currentConversationId}
              onSelect={handleSelect}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
