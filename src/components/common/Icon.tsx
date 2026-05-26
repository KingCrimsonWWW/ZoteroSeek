/**
 * Icon - SVG icon replacement for XUL namespace compatibility
 *
 * React 18 DOM sanitizer flattens `<svg>` in XUL namespace (namespace mismatch).
 * Use `<img src="chrome://zoteroseek/content/icons/...">` instead.
 */

import React from 'react';

interface IconProps {
  name: string;
  className?: string;
  alt?: string;
}

export function Icon({ name, className, alt }: IconProps) {
  return (
    <img
      src={`chrome://zoteroseek/content/icons/${name}.svg`}
      className={className}
      alt={alt || ''}
      style={{ display: 'inline-block' }}
    />
  );
}
