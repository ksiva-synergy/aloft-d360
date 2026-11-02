'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AgentInspection } from '@/lib/agents/inspection';

/**
 * Admin-only technical note under an agent reply. The server omits `inspection`
 * for everyone else, so this renders only when that note was actually sent.
 */
export function AnswerInspection({ inspection, queries = [] }: { inspection: AgentInspection; queries?: string[] }) {
  const [open, setOpen] = useState(false);
  const parts = [
    inspection.sources ? { label: 'Sources', text: inspection.sources } : null,
    inspection.joins ? { label: 'Join', text: inspection.joins } : null,
    inspection.caveats ? { label: 'Caveats', text: inspection.caveats } : null,
  ].filter((part): part is { label: string; text: string } => !!part);
  if (parts.length === 0 && queries.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-size-ui text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        Inspect
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-[var(--line-1)] bg-[var(--surface-2)] px-3.5 py-3 text-size-ui leading-relaxed text-[var(--ink-2)]">
          {parts.map((part) => (
            <div key={part.label}>
              <p className="mb-1 font-medium text-[var(--ink-3)]">{part.label}</p>
              <p className="whitespace-pre-wrap">{part.text}</p>
            </div>
          ))}
          {queries.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-[var(--ink-3)]">{queries.length === 1 ? 'SQL' : `SQL (${queries.length} queries)`}</p>
              <div className="space-y-2">
                {queries.map((sql, i) => (
                  <pre
                    key={i}
                    className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3 py-2 font-mono text-[length:var(--type-caption-size)] text-[var(--ink-1)]"
                  >
                    {sql}
                  </pre>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
