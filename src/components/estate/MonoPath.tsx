'use client';

import React from 'react';

interface MonoPathProps {
  path: string;
  truncate?: boolean;
}

export default function MonoPath({ path, truncate = true }: MonoPathProps) {
  return (
    <span
      className={`font-mono text-[12px] tracking-wide text-slate-800 dark:text-slate-100 ${
        truncate ? 'block truncate max-w-[280px] sm:max-w-[420px] md:max-w-[550px]' : ''
      }`}
      title={path}
    >
      {path}
    </span>
  );
}
