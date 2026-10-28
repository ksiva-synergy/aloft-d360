'use client';

import { useState, type FormEvent } from 'react';
import { FileText, Loader2, MessageSquareText, Search } from 'lucide-react';
import { Chip, btn, fieldInput, fieldShell } from '@/views/agent-lab/flows/ui';
import { api, type Citation } from './shared';

// Try a question the way an agent would: the same hybrid search (meaning + exact words), the same
// pieces and the same citations an agent or automation gets.

const MATCHED: Record<Citation['matchedBy'], string> = { both: 'Meaning and words', meaning: 'Meaning', words: 'Exact words' };

export function SearchTab({ kbId, readyDocuments }: { kbId: string; readyDocuments: number }) {
  const [question, setQuestion] = useState('');
  const [results, setResults] = useState<Citation[] | null>(null);
  const [asked, setAsked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError(null);
    const res = await api<{ results?: Citation[] }>('/api/knowledge/search', { method: 'POST', body: { question: q, knowledgeBaseIds: [kbId], limit: 8 } });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ?? `Search failed (${res.status})`);
    setResults(res.data.results ?? []);
    setAsked(q);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2">
        <label className={`${fieldShell} h-10 flex-1`}>
          <Search className="h-4 w-4 shrink-0 text-[var(--ink-3)]" aria-hidden />
          <input className={`${fieldInput} text-size-ui`} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How often is the emergency fire pump tested?" aria-label="Question" />
        </label>
        <button type="submit" className={`${btn.primary} h-10`} disabled={busy || question.trim().length < 2}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Search
        </button>
      </form>
      {readyDocuments === 0 && <p className="text-size-caption text-[var(--ink-3)]">Nothing is ready to search yet. Documents become searchable once they show Ready.</p>}
      {error && <p className="rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">{error}</p>}
      {results && results.length === 0 && <p className="py-6 text-center text-size-ui text-[var(--ink-3)]">Nothing found for “{asked}”.</p>}
      {results && results.length > 0 && (
        <ol aria-label="Results" className="space-y-2">
          {results.map((c, i) => (
            <li key={`${c.documentId}-${i}`} className="rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-size-caption">
                <span className="font-semibold text-[var(--ink-3)]">{i + 1}</span>
                {c.kind === 'qa' ? <MessageSquareText className="h-3.5 w-3.5 text-[var(--ink-3)]" aria-hidden /> : <FileText className="h-3.5 w-3.5 text-[var(--ink-3)]" aria-hidden />}
                {c.documentId && c.kind !== 'qa' ? (
                  <a className="font-medium text-[var(--brand-a-ink)] hover:underline" href={`/api/knowledge/${kbId}/documents/${c.documentId}`}>
                    {c.document}
                  </a>
                ) : (
                  <span className="font-medium text-[var(--ink-1)]">{c.kind === 'qa' ? 'Q&A' : c.document}</span>
                )}
                {c.page != null && <Chip>page {c.page}</Chip>}
                {c.section && <span className="truncate text-[var(--ink-3)]">{c.section}</span>}
                <span className="ml-auto text-[var(--ink-3)]">{MATCHED[c.matchedBy]}</span>
              </div>
              <p className="mt-1.5 line-clamp-6 whitespace-pre-wrap text-size-ui text-[var(--ink-2)]">{c.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
