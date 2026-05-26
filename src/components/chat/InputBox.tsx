/**
 * Input box component for ZoteroSeek
 * 支持禁用状态（离线时）和防抖保护
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
      : 'Ask a question about your research...';

  return (
    <div className="flex items-center gap-2 bg-zs-bg-tertiary rounded-xl border border-zs-border px-3 py-2 focus-within:border-zs-accent transition-colors">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isDisabled}
        className="flex-1 resize-none bg-transparent text-zs-text-primary placeholder:text-zs-text-secondary text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        rows={1}
      />
      <XulButton
        onClick={handleSubmit}
        disabled={isDisabled || !input.trim()}
        className="bg-zs-accent text-white rounded-full w-8 h-8 flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Icon name="send" className="h-4 w-4" />
      </XulButton>
    </div>
  );
}
