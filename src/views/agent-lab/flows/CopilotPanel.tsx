'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUp, Check, Loader2, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Def } from '@/lib/flows/edit';
import type { FlowDiff } from '@/lib/flows/copilot';
import type { PolicyFinding } from '@/lib/flows/policy';
import { btn } from './ui';

// Chat editing. Each turn sends the current draft and the request to /api/agent-lab/flows/copilot,
// which returns a checked proposal. The proposal is previewed on the canvas; nothing changes until
// the user applies it, and nothing is saved until they save the workflow.

/** `findings`: every policy finding after the change. `introduced`: the ones the draft did not already have. */
export type CopilotProposal = { id: string; definition: Def; changes: string[]; diff: FlowDiff; findings: PolicyFinding[]; introduced: PolicyFinding[] };

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; proposal?: CopilotProposal; problems?: string[] }
  | { role: 'error'; text: string };

const SUGGESTIONS = ['Run this every Monday at 09:00', 'Add a human approval before anything is sent', 'Explain what this workflow does', 'Set a budget of $0.50 per run'];

type Props = {
  def: Def | null;
  /** The proposal currently previewed on the canvas, if any. */
  pendingId: string | null;
  /** What happened to each proposal, wherever it was applied or discarded. */
  outcomes: Record<string, 'applied' | 'discarded'>;
  onPropose: (p: CopilotProposal) => void;
  onApply: (p: CopilotProposal) => void;
  onDiscard: (p: CopilotProposal) => void;
  /** A goal to send as soon as the panel opens (from "Start building"). */
  seed?: string;
};

export default function CopilotPanel({ def, pendingId, outcomes, onPropose, onApply, onDiscard, seed }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !def) return;
    const history = messages.filter((m): m is Exclude<Msg, { role: 'error' }> => m.role !== 'error').map((m) => ({ role: m.role, text: m.text }));
    setMessages((ms) => [...ms, { role: 'user', text: message }]);
    setDraft('');
    setBusy(true);
    try {
      const res = await fetch('/api/agent-lab/flows/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: def, message, history }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        proposal?: Omit<CopilotProposal, 'id'> | null;
        problems?: string[];
        error?: string;
        details?: { code?: string };
      };
      if (!res.ok) {
        if (data.details?.code === 'copilot_unavailable') setUnavailable(true);
        setMessages((ms) => [...ms, { role: 'error', text: data.error ?? `The copilot request failed (${res.status}).` }]);
        return;
      }
      const proposal = data.proposal ? { ...data.proposal, id: `p${++seq.current}` } : undefined;
      setMessages((ms) => [...ms, { role: 'assistant', text: data.reply || (proposal ? 'Here is a proposed change.' : 'Done.'), proposal, problems: data.problems }]);
      if (proposal) onPropose(proposal);
    } catch {
      setMessages((ms) => [...ms, { role: 'error', text: 'Could not reach the server.' }]);
    } finally {
      setBusy(false);
    }
  };

  // Send the goal from "Start building" once. The panel is remounted per workflow.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !seed?.trim() || !def) return;
    seeded.current = true;
    queueMicrotask(() => void send(seed));
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <p className="text-size-ui font-semibold text-[var(--ink-1)]">Edit this workflow by describing the change</p>
            </div>
            <p className="mt-2 text-size-ui text-[var(--ink-3)]">
              Copilot proposes changes and shows them on the canvas. Nothing changes until you apply it, and every proposal is checked against your permissions first.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={!def || unavailable} onClick={() => void send(s)} className="rounded-full border border-[var(--line-1)] px-2.5 py-1 text-size-caption text-[var(--ink-2)] hover:border-[var(--brand-a)] hover:text-[var(--brand-a)] disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'user')
            return (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--brand-a)] px-3 py-2 text-size-ui text-white">{m.text}</p>
              </div>
            );
          if (m.role === 'error')
            return (
              <p key={i} role="alert" className="flex gap-2 rounded-xl bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {m.text}
              </p>
            );
          const p = m.proposal;
          const introduced = (p?.introduced ?? []).filter((f) => f.severity === 'error');
          const stillBlocking = (p?.findings ?? []).filter((f) => f.severity === 'error').length - introduced.length;
          const status = p ? outcomes[p.id] : undefined;
          const stale = p && !status && p.id !== pendingId;
          return (
            <div key={i} className="space-y-2">
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                </span>
                <p className="min-w-0 whitespace-pre-wrap text-size-ui text-[var(--ink-1)]">{m.text}</p>
              </div>
              {m.problems && m.problems.length > 0 && (
                <ul className="ml-8 list-disc space-y-0.5 pl-4 text-size-caption text-[var(--ink-3)]">
                  {m.problems.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
              {p && (
                <div className="ml-8 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]" aria-label="Proposed changes">
                  <ul className="space-y-1 px-3 py-2.5">
                    {p.changes.map((c) => (
                      <li key={c} className="flex gap-2 text-size-ui text-[var(--ink-2)]">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-a)]" aria-hidden />
                        {c}
                      </li>
                    ))}
                  </ul>
                  {introduced.length > 0 && (
                    <div className="border-t border-[var(--line-1)] px-3 py-2 text-size-caption text-[var(--bad)]">
                      <p className="font-semibold">This change would block publishing:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {introduced.map((f, n) => (
                          <li key={n}>{f.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {stillBlocking > 0 && (
                    <p className="border-t border-[var(--line-1)] px-3 py-2 text-size-caption text-[var(--ink-3)]">
                      {stillBlocking} issue{stillBlocking > 1 ? 's' : ''} that already blocked publishing remain{stillBlocking > 1 ? '' : 's'}.
                    </p>
                  )}
                  <div className="flex items-center gap-2 border-t border-[var(--line-1)] px-3 py-2">
                    {status === 'applied' && (
                      <span className="inline-flex items-center gap-1 text-size-caption font-medium text-[var(--ok)]">
                        <Check className="h-3.5 w-3.5" /> Applied to the draft
                      </span>
                    )}
                    {status === 'discarded' && <span className="text-size-caption text-[var(--ink-3)]">Discarded</span>}
                    {stale && <span className="text-size-caption text-[var(--ink-3)]">Out of date: the draft changed after this proposal.</span>}
                    {!status && !stale && (
                      <>
                        <button
                          type="button"
                          className={btn.primary}
                          onClick={() => onApply(p)}
                        >
                          <Check className="h-3.5 w-3.5" /> Apply
                        </button>
                        <button
                          type="button"
                          className={btn.ghost}
                          onClick={() => onDiscard(p)}
                        >
                          <X className="h-3.5 w-3.5" /> Discard
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <p className="flex items-center gap-2 text-size-ui text-[var(--ink-3)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Working on it…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-[var(--line-1)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        {unavailable && <p className="mb-2 text-size-caption text-[var(--ink-3)]">Copilot is not available on this server. You can still edit everything in the Edit tab.</p>}
        {!def && <p className="mb-2 text-size-caption text-[var(--ink-3)]">Fix the code view first: Copilot needs a readable draft.</p>}
        <div className={cn('flex items-end gap-2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-2 focus-within:border-[var(--brand-a)]', (!def || unavailable) && 'opacity-60')}>
          <label htmlFor="copilot-input" className="sr-only">
            Describe a change
          </label>
          <textarea
            id="copilot-input"
            rows={2}
            value={draft}
            disabled={!def || unavailable}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder="e.g. Only email suppliers when the order is more than 5 days late"
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent text-size-ui text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
          />
          <button type="submit" aria-label="Send" disabled={busy || !draft.trim() || !def || unavailable} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-a)] text-white disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
