'use client';

import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, Loader2 } from 'lucide-react';
import { extractRefs } from '@/lib/flows/validate';
import { btn } from './ui';

// "Search knowledge" step: choose the knowledge bases to search (the ones this person may search)
// and try the search for real. A step's output is { chunks: [{ text, cite, document, page, … }] }.

type KnowledgeOption = { id: string; name: string; description: string | null; scope: string; archived: boolean; documents: number };
type Citation = { text: string; knowledgeBaseId: string; documentId: string | null; document: string | null; section: string | null; page: number | null; kind: string };

const field = 'h-8 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

/** "SMS Manual.pdf, p. 12, 4.2 Fire pumps" — same form agents cite in. */
export const citeAs = (c: Citation) => (c.kind === 'qa' ? 'Q&A' : [c.document ?? 'document', c.page != null ? `p. ${c.page}` : null, c.section].filter(Boolean).join(', '));

export function KnowledgePicker({ id, value, onChange }: { id: string; value: string[]; onChange: (ids: string[]) => void }) {
  const [list, setList] = useState<KnowledgeOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/knowledge');
      const data = (await res.json().catch(() => ({}))) as { knowledgeBases?: KnowledgeOption[] };
      if (cancelled) return;
      setFailed(!res.ok);
      setList(res.ok ? (data.knowledgeBases ?? []) : []);
    })().catch(() => {
      if (!cancelled) {
        setFailed(true);
        setList([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (kbId: string) => onChange(value.includes(kbId) ? value.filter((v) => v !== kbId) : [...value, kbId]);
  const usable = (list ?? []).filter((k) => !k.archived);
  const missing = list ? value.filter((v) => !usable.some((k) => k.id === v)) : [];
  return (
    <div id={id}>
      {!list && <p className="text-size-caption text-[var(--ink-3)]">Loading knowledge bases…</p>}
      {list && usable.length === 0 && <p className="text-size-caption text-[var(--ink-3)]">{failed ? 'Could not load the knowledge bases.' : 'No knowledge bases yet.'}</p>}
      {usable.length > 0 && (
        <ul className="space-y-1">
          {usable.map((k) => (
            <li key={k.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--surface-2)]">
                <input type="checkbox" className="mt-0.5" checked={value.includes(k.id)} onChange={() => toggle(k.id)} />
                <span className="min-w-0">
                  <span className="block text-size-ui text-[var(--ink-1)]">{k.name}</span>
                  <span className="block truncate text-size-caption text-[var(--ink-3)]">
                    {k.scope === 'org' ? 'Organisation' : 'Personal'} · {k.documents} ready{k.description ? ` · ${k.description}` : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {missing.map((m) => (
        <p key={m} className="mt-1 flex items-center justify-between gap-2 text-size-caption text-[var(--warn)]">
          <span className="font-mono">{m}</span> not found, archived or not shared with you
          <button type="button" className={btn.ghost} onClick={() => toggle(m)}>
            Remove
          </button>
        </p>
      ))}
      <a href="/agent-lab/knowledge" target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-size-caption font-medium text-[var(--brand-a)] hover:underline">
        Knowledge <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </div>
  );
}

export function TryKnowledge({
  stepId,
  query,
  knowledgeBaseIds,
  topK,
  onUseAsSample,
}: {
  stepId: string;
  query: string;
  knowledgeBaseIds: string[];
  topK: number;
  onUseAsSample: (output: Record<string, unknown>) => void;
}) {
  const [sample, setSample] = useState(query);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Citation[] | null>(null);
  const refs = extractRefs(sample);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: sample.trim(), knowledgeBaseIds, limit: Math.min(25, topK) }),
      });
      const data = (await res.json().catch(() => ({}))) as { results?: Citation[]; error?: string };
      if (!res.ok) setError(data.error ?? `The search failed (${res.status})`);
      else setResults(data.results ?? []);
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  if (!knowledgeBaseIds.length) return <p className="text-size-caption text-[var(--ink-3)]">Choose a knowledge base to try the search.</p>;
  return (
    <div className="space-y-2">
      <label htmlFor={`${stepId}-try-query`} className="block text-size-caption text-[var(--ink-3)]">
        One real search. Replace any {'{{…}}'} with sample words first.
      </label>
      <input id={`${stepId}-try-query`} className={field} value={sample} onChange={(e) => setSample(e.target.value)} />
      {refs.length > 0 && <p className="text-size-caption text-[var(--warn)]">Replace {refs.map((r) => r.raw).slice(0, 3).join(', ')} with sample words.</p>}
      <button type="button" className={btn.secondary} disabled={busy || sample.trim().length < 2 || refs.length > 0} onClick={() => void run()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />} Try it
      </button>
      {error && (
        <p role="alert" className="rounded-lg bg-[var(--bad-bg)] px-2.5 py-2 text-size-caption text-[var(--bad)]">
          {error}
        </p>
      )}
      {results && (
        <div className="rounded-xl border border-[var(--line-1)]">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-size-caption text-[var(--ink-3)]">Nothing found.</p>
          ) : (
            <ol aria-label="Search results" className="divide-y divide-[var(--line-1)]">
              {results.map((c, i) => (
                <li key={i} className="px-3 py-2">
                  <p className="text-size-caption font-medium text-[var(--ink-2)]">{citeAs(c)}</p>
                  <p className="mt-0.5 line-clamp-3 text-size-caption text-[var(--ink-3)]">{c.text}</p>
                </li>
              ))}
            </ol>
          )}
          <div className="flex justify-end border-t border-[var(--line-1)] px-3 py-2">
            <button
              type="button"
              className={btn.ghost}
              onClick={() =>
                onUseAsSample({
                  chunks: results.map((c) => ({ text: c.text, cite: citeAs(c), document: c.document, page: c.page, section: c.section, knowledgeBaseId: c.knowledgeBaseId, documentId: c.documentId })),
                })
              }
            >
              Use as sample response
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
