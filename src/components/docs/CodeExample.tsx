'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeExampleProps {
  code: string;
  language?: string;
  title?: string;
  className?: string;
}

export function CodeExample({ code, language = 'json', title, className }: CodeExampleProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn('rounded-lg border border-slate-200 dark:border-[var(--line-1)] overflow-hidden', className)}>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-[var(--surface-1)] border-b border-slate-200 dark:border-[var(--line-1)]">
        <div className="flex items-center gap-2">
          {title && (
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {title}
            </span>
          )}
          <span className="text-xs font-mono text-[var(--ink-3)] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
            {language}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-[var(--ink-3)] hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              <span className="text-emerald-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto bg-white dark:bg-[var(--background)]">
        <code className="text-xs text-slate-700 dark:text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">
          {code}
        </code>
      </pre>
    </div>
  );
}
