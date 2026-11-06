'use client';

import { Select } from '@/components/form/Select';
import { useEffect, useState } from 'react';
import { Bot, ExternalLink, Loader2 } from 'lucide-react';
import { extractRefs } from '@/lib/flows/validate';
import type { CustomField } from '@/lib/extraction/schemas';
import { btn } from './ui';

// "Ask an agent" step: pick a saved agent (the ones agent chat runs) and try it once for real.
// Drafts are listed so they can be tried; publishing needs a ready agent (the policy check says so).

type AgentOption = { slug: string; name: string; description: string | null; status: string | null; runnable: boolean; hasInstructions?: boolean };

const field = 'h-8 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';
const area = 'w-full resize-y rounded-lg border border-[var(--line-1)] bg-[var(--surface-2)] p-2 font-mono text-size-caption text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

export function AgentPicker({ id, value, onChange }: { id: string; value: string; onChange: (slug: string | undefined) => void }) {
  const [list, setList] = useState<AgentOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/agent-lab/flows/agents');
      const data = (await res.json().catch(() => ({}))) as { agents?: AgentOption[] };
      if (cancelled) return;
      setFailed(!res.ok);
      setList(res.ok ? (data.agents ?? []) : []);
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

  const ready = (list ?? []).filter((a) => a.runnable);
  const drafts = (list ?? []).filter((a) => !a.runnable && a.hasInstructions !== false);
  // Catalog entries with no instructions cannot run at all; shown so their absence is explained.
  const notSetUp = (list ?? []).filter((a) => a.hasInstructions === false);
  const chosen = (list ?? []).find((a) => a.slug === value);
  // Several agents can share a name; the slug tells them apart.
  const label = (a: AgentOption) => ((list ?? []).filter((x) => x.name === a.name).length > 1 ? `${a.name} (${a.slug})` : a.name);
  return (
    <>
      <Select id={id} className={field} value={value} disabled={!list} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{list ? 'No saved agent (plain AI prompt, no tools)' : 'Loading agents…'}</option>
        {value && list && !chosen && <option value={value}>{value} (not found)</option>}
        {ready.length > 0 && (
          <optgroup label="Ready">
            {ready.map((a) => (
              <option key={a.slug} value={a.slug}>
                {label(a)}
              </option>
            ))}
          </optgroup>
        )}
        {drafts.length > 0 && (
          <optgroup label="Drafts (can be tried, not published)">
            {drafts.map((a) => (
              <option key={a.slug} value={a.slug}>
                {label(a)} · {a.status ?? 'draft'}
              </option>
            ))}
          </optgroup>
        )}
        {notSetUp.length > 0 && (
          <optgroup label="Not set up (no instructions)">
            {notSetUp.map((a) => (
              <option key={a.slug} value={a.slug} disabled={a.slug !== value}>
                {label(a)}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-size-caption text-[var(--ink-3)]">
        {failed ? 'Could not load the saved agents.' : chosen?.description ? chosen.description : 'A saved agent can look things up with read-only data tools.'}
        <a href="/agent-lab/agents" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--brand-a)] hover:underline">
          Agents <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </p>
    </>
  );
}

type TryResult = {
  agent: { name: string };
  model: string;
  outcome: string;
  text: string;
  answer: { values: Record<string, string | number | null>; missing: string[]; issues: Record<string, string>; notes: string | null } | null;
  answerProblem?: string;
  errorDetail?: string;
  loops: number;
  toolCalls: number;
  costUsd: number;
  durationMs: number;
  /** Knowledge bases the agent could search in this run. */
  knowledgeBases?: string[];
};

export function TryAgent({
  stepId,
  agentSlug,
  prompt,
  answer,
  model,
  onUseAsSample,
}: {
  stepId: string;
  agentSlug?: string;
  prompt: string;
  answer?: CustomField[];
  model?: string;
  onUseAsSample: (output: Record<string, unknown>) => void;
}) {
  const [sample, setSample] = useState(prompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TryResult | null>(null);
  const refs = extractRefs(sample);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/agent-lab/flows/agent-try', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentSlug, prompt: sample.trim(), ...(answer ? { answer } : {}), ...(model ? { model } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as TryResult & { error?: string };
      if (!res.ok) setError(data.error ?? `The agent could not run (${res.status})`);
      else setResult(data);
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  if (!agentSlug) return <p className="text-size-caption text-[var(--ink-3)]">Choose a saved agent to try it.</p>;
  return (
    <div className="space-y-2">
      <label htmlFor={`${stepId}-try-prompt`} className="block text-size-caption text-[var(--ink-3)]">
        One real run of the agent. Replace any {'{{…}}'} with sample values first.
      </label>
      <textarea id={`${stepId}-try-prompt`} rows={4} className={area} value={sample} onChange={(e) => setSample(e.target.value)} />
      {refs.length > 0 && <p className="text-size-caption text-[var(--warn)]">Replace {refs.map((r) => r.raw).slice(0, 3).join(', ')} with sample values.</p>}
      <button type="button" className={btn.secondary} disabled={busy || !sample.trim() || refs.length > 0} onClick={() => void run()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} Try it
      </button>
      {error && (
        <p role="alert" className="rounded-lg bg-[var(--bad-bg)] px-2.5 py-2 text-size-caption text-[var(--bad)]">
          {error}
        </p>
      )}
      {result && (
        <div className="rounded-xl border border-[var(--line-1)]">
          <p className="border-b border-[var(--line-1)] px-3 py-2 text-size-caption text-[var(--ink-2)]">
            <span className="font-semibold text-[var(--ink-1)]">{result.agent.name}</span> · {result.model} · {result.loops} round{result.loops === 1 ? '' : 's'}, {result.toolCalls} data lookup
            {result.toolCalls === 1 ? '' : 's'} · {(result.durationMs / 1000).toFixed(1)} s · about ${result.costUsd.toFixed(3)}
            {result.knowledgeBases?.length ? ` · knowledge: ${result.knowledgeBases.join(', ')}` : ''}
          </p>
          {result.errorDetail && <p className="px-3 pt-2 text-size-caption text-[var(--bad)]">{result.errorDetail}</p>}
          {answer && result.answer && (
            <table aria-label="Agent answer" className="w-full text-left text-size-caption">
              <tbody>
                {answer.map((f) => (
                  <tr key={f.key} className="border-b border-[var(--line-1)] align-top">
                    <th scope="row" className="w-2/5 px-3 py-1.5 font-medium text-[var(--ink-2)]">
                      {f.label || f.key}
                    </th>
                    <td className="px-3 py-1.5">
                      {result.answer!.values[f.key] !== null && result.answer!.values[f.key] !== undefined ? (
                        <span className="text-[var(--ink-1)]">{String(result.answer!.values[f.key])}</span>
                      ) : (
                        <span className="text-[var(--ink-3)]">{result.answer!.issues[f.key] ? `Not accepted: ${result.answer!.issues[f.key]}` : 'Not known'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {answer && result.answerProblem && <p className="px-3 pt-2 text-size-caption text-[var(--warn)]">{result.answerProblem}</p>}
          {(result.answer?.notes || result.text) && <p className="whitespace-pre-wrap px-3 py-2 text-size-caption text-[var(--ink-2)]">{result.answer?.notes ?? result.text}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--line-1)] px-3 py-2">
            <span className="text-size-caption text-[var(--ink-3)]">Agent answers can be wrong. Check before relying on them.</span>
            <button
              type="button"
              className={btn.ghost}
              onClick={() =>
                onUseAsSample({ text: result.text, ...(result.answer ? { values: result.answer.values, missing: result.answer.missing, notes: result.answer.notes } : {}) })
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
