/**
 * Header component for ZoteroSeek panel
 */

import React from 'react';

interface HeaderProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onClose: () => void;
  isDragging: boolean;
}

export function Header({ onMouseDown, onClose, isDragging }: HeaderProps) {
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
  );
}
