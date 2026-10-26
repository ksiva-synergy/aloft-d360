'use client';

import React from 'react';

interface MonoPathProps {
  path: string;
  truncate?: boolean;
}

export default function MonoPath({ path, truncate = true }: MonoPathProps) {
  return (
    <span
      className={`font-mono text-size-ui tracking-wide text-[color:var(--ink-1)] dark:text-[color:var(--ink-1)] ${
        truncate ? 'block truncate max-w-[280px] sm:max-w-[420px] md:max-w-[550px]' : ''
      }`}
      title={path}
    >
      {path}
    </span>
  );
}
