/**
 * Input box component for ZoteroSeek
 * 支持禁用状态（离线时）和防抖保护
 * Round send button with clean input row.
 */

import React, { useState, useRef, useCallback } from 'react';
import { XulButton } from '@/components/common/XulButton';
import { Icon } from '@/components/common/Icon';

interface InputBoxProps {
  onSend: (content: string) => void;
  isLoading: boolean;
  /** 外部禁用（如离线状态） */
  disabled?: boolean;
}

export function InputBox({ onSend, isLoading, disabled = false }: InputBoxProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDisabled = isLoading || disabled;

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed && !isDisabled) {
      onSend(trimmed);
      setInput('');
      // 重置 textarea 高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [input, isDisabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, []);

  const placeholder = disabled
    ? '网络连接已断开...'
    : isLoading
      ? '正在生成回复...'
      : 'Ask about your research...';

  return (
    <div className="max-w-[900px] mx-auto w-full">
      <div className="flex items-center gap-2 bg-[#1a1a1e] rounded-[14px] border border-white/[0.06] focus-within:border-[#5B7FFF] px-4 h-[52px] transition-colors duration-150">
        {/* Attachment / plus button */}
        <XulButton className="h-8 w-8 rounded-lg text-[#888] hover:text-[#ececec] hover:bg-white/[0.04] flex-shrink-0" title="Attach">
          <Icon name="plus" className="h-4 w-4" />
        </XulButton>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isDisabled}
          className="flex-1 bg-transparent text-[15px] text-[#ececec] placeholder:text-[#888] outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
          rows={1}
        />

        {/* Send button */}
        <XulButton
          onClick={handleSubmit}
          disabled={isDisabled || !input.trim()}
          className="h-10 w-10 rounded-full bg-[#5B7FFF] text-white flex items-center justify-center hover:bg-[#4A6EE0] transition-colors duration-150 flex-shrink-0 disabled:opacity-30"
        >
          <Icon name="send" className="h-4 w-4" />
        </XulButton>
      </div>
    </div>
  );
}
