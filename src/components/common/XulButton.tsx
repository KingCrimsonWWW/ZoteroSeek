/**
 * XulButton - button replacement for XUL namespace compatibility
 *
 * React 18 DOM sanitizer removes `<button>` in XUL namespace (namespace mismatch).
 * Use `<div role="button">` as a drop-in replacement with full keyboard accessibility.
 */

import React from 'react';

interface XulButtonProps extends React.HTMLAttributes<HTMLDivElement> {
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

export function XulButton({ onClick, disabled, title, className, children, ...props }: XulButtonProps) {
  const handleActivate = (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent) => {
    if (disabled) return;
    onClick?.(e as React.MouseEvent<HTMLDivElement>);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate(e);
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      title={title}
      className={className}
      onClick={disabled ? undefined : handleActivate}
      onKeyDown={disabled ? undefined : handleKeyDown}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      {...props}
    >
      {children}
    </div>
  );
}
