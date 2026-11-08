'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Loader2, Play, X } from 'lucide-react';
import type { Def } from '@/lib/flows/edit';
import { Chip, StepIcon, btn, pretty, usd, type Tone } from './ui';

// Real runs of a published automation: start one, see past runs, open one to see every step.
// Test runs (sample data, nothing sent) live in the Test run drawer; this is the live record.

type Run = {
  id: string;
  status: string;
  error: string | null;
  triggeredBy: string | null;
  totalTokens: number;
  costUsd: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};
type RunStep = { stepId: string; status: string; attempts: number; output?: unknown; skipReason?: string; error: string | null; startedAt: string | null; finishedAt: string | null };
type RunDetail = Run & { steps: RunStep[] };

const TONE: Record<string, Tone> = { succeeded: 'ok', failed: 'bad', cancelled: 'neutral', skipped: 'neutral', waiting_approval: 'warn', running: 'brand', queued: 'neutral', pending: 'neutral' };
const LABEL: Record<string, string> = { waiting_approval: 'Waiting for approval' };
const label = (s: string) => LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

const seconds = (a: string | null, b: string | null) => (a && b ? `${Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000).toFixed(1)}s` : '');

async function readJson<T>(res: Response): Promise<T & { error?: string; details?: { findings?: { message: string }[] } }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string; details?: { findings?: { message: string }[] } };
}

function StepOutput({ value }: { value: unknown }) {
  const text = pretty(value);
  return (
    <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[var(--surface-2)] p-2 font-mono text-size-caption text-[var(--ink-2)]">
      {text.length > 4000 ? `${text.slice(0, 4000)}…` : text}
    </pre>
  );
}

export default function RunsPanel({ flowId, def, status, dirty, onClose }: { flowId: string; def: Def | null; status: string; dirty: boolean; onClose: () => void }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState<null | 'approve' | 'reject'>(null);

  const declared = def?.inputs ?? [];
  const canRun = status === 'active' && !dirty;
  const whyNot = status !== 'active' ? 'Publish this automation to run it for real.' : dirty ? 'Save your changes first: a run uses the published version.' : null;

  const load = useCallback(async () => {
    const res = await fetch(`/api/agent-lab/flows/${flowId}/runs`);
    const data = await readJson<{ runs?: Run[] }>(res);
    if (res.ok) setRuns(data.runs ?? []);
    else setError(data.error ?? 'Could not load runs');
  }, [flowId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/agent-lab/flows/${flowId}/runs`);
      const data = await readJson<{ runs?: Run[] }>(res);
      if (cancelled) return;
      if (res.ok) setRuns(data.runs ?? []);
      else setError(data.error ?? 'Could not load runs');
    })().catch(() => !cancelled && setError('Could not reach the server'));
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  const open = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/agent-lab/flows/${flowId}/runs/${id}`);
    const data = await readJson<{ run?: RunDetail }>(res);
    if (res.ok && data.run) setDetail(data.run);
    else setError(data.error ?? 'Could not load that run');
  };

  const decide = async (stepId: string, decision: 'approve' | 'reject') => {
    if (!detail) return;
    setError(null);
    setDeciding(decision);
    try {
      const res = await fetch(`/api/agent-lab/flows/${flowId}/runs/${detail.id}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId, decision, comment: comment.trim() || undefined }),
      });
      const data = await readJson<{ run?: Run }>(res);
      let problem: string | null = null;
      if (!res.ok) {
        const why = data.details?.findings?.map((f) => f.message).join('; ');
        problem = res.status === 403 || res.status === 404 ? 'You are not allowed to decide this approval.' : (why ?? data.error ?? 'The decision could not be saved');
      } else setComment('');
      // Reload either way (someone else may have decided already), then show any problem: open() clears errors.
      await open(detail.id);
      await load();
      if (problem) setError(problem);
    } catch {
      setError('Could not reach the server');
    } finally {
      setDeciding(null);
    }
  };

  const runNow = async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/agent-lab/flows/${flowId}/runs`, {
        method: 'POST',
        // One key per click: a retried request returns the same run instead of starting another.
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ inputs }),
      });
      const data = await readJson<{ run?: Run }>(res);
      if (!res.ok || !data.run) {
        const why = data.details?.findings?.map((f) => f.message).join('; ');
        setError(why ?? data.error ?? 'The run could not start');
      } else await open(data.run.id);
      await load();
    } catch {
      setError('Could not reach the server');
    } finally {
      setStarting(false);
    }
  };

  const input = 'h-8 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

  return (
    <aside aria-label="Runs" className="absolute inset-y-0 right-0 z-20 flex w-[min(460px,100%)] flex-col border-l border-[var(--line-1)] bg-[var(--surface-1)] shadow-xl">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--line-1)] px-3">
        {detail && (
          <button type="button" className={btn.icon} aria-label="Back to all runs" onClick={() => setDetail(null)}>
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <h2 className="text-size-body font-semibold text-[var(--ink-1)]">{detail ? 'Run' : 'Runs'}</h2>
        <span className="flex-1" />
        <button type="button" className={btn.icon} aria-label="Close runs" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p role="alert" className="mx-3 mt-3 rounded-xl bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {detail ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={TONE[detail.status] ?? 'neutral'}>{label(detail.status)}</Chip>
              <span className="text-size-caption text-[var(--ink-3)]">
                {new Date(detail.createdAt).toLocaleString()} · {usd(detail.costUsd)} · {detail.totalTokens} tokens {seconds(detail.startedAt, detail.finishedAt) && `· ${seconds(detail.startedAt, detail.finishedAt)}`}
              </span>
            </div>
            {detail.error && <p className="rounded-xl bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">{detail.error}</p>}
            {detail.steps
              .filter((r) => r.status === 'waiting_approval')
              .map((r) => {
                const step = def?.steps?.find((x) => x.id === r.stepId);
                const message = typeof step?.config.message === 'string' ? step.config.message : '';
                return (
                  <section key={r.stepId} aria-label="Approval needed" className="space-y-2 rounded-xl border border-[var(--warn)] bg-[var(--warn-bg)] p-3">
                    <p className="text-size-ui font-semibold text-[var(--warn)]">Waiting for approval: {step?.name || r.stepId}</p>
                    {message && <p className="whitespace-pre-wrap text-size-ui text-[var(--ink-1)]">{message}</p>}
                    <label htmlFor="approval-comment" className="sr-only">
                      Comment (optional)
                    </label>
                    <input id="approval-comment" className={input} placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" className={btn.primary} disabled={deciding !== null} onClick={() => void decide(r.stepId, 'approve')}>
                        {deciding === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                      </button>
                      <button type="button" className={btn.secondary} disabled={deciding !== null} onClick={() => void decide(r.stepId, 'reject')}>
                        {deciding === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Reject
                      </button>
                    </div>
                  </section>
                );
              })}
            <ol className="space-y-2">
              {(def?.steps ?? [])
                .map((s) => ({ s, r: detail.steps.find((x) => x.stepId === s.id) }))
                .map(({ s, r }) => (
                  <li key={s.id} className="rounded-xl border border-[var(--line-1)] p-2.5">
                    <div className="flex items-center gap-2">
                      <StepIcon type={s.type} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-size-ui font-medium text-[var(--ink-1)]">{s.name || s.id}</span>
                      <Chip tone={TONE[r?.status ?? 'pending'] ?? 'neutral'}>{label(r?.status ?? 'not reached')}</Chip>
                    </div>
                    {r && r.attempts > 1 && <p className="mt-1 text-size-caption text-[var(--ink-3)]">{r.attempts} attempts</p>}
                    {r?.error && <p className="mt-1 text-size-caption text-[var(--bad)]">{r.error}</p>}
                    {r?.skipReason && <p className="mt-1 text-size-caption text-[var(--ink-3)]">Skipped: {r.skipReason}</p>}
                    {r?.output !== undefined && r.output !== null && <StepOutput value={r.output} />}
                  </li>
                ))}
            </ol>
          </div>
        ) : (
          <div className="space-y-4">
            <section aria-label="Run now" className="space-y-2 rounded-xl border border-[var(--line-1)] p-3">
              {declared.map((inp) => (
                <div key={inp.name}>
                  <label htmlFor={`run-input-${inp.name}`} className="mb-1 block text-size-caption font-medium text-[var(--ink-2)]">
                    {inp.name}
                    {inp.required !== false && <span className="text-[var(--bad)]"> *</span>}
                  </label>
                  {inp.type === 'boolean' ? (
                    <input id={`run-input-${inp.name}`} type="checkbox" checked={inputs[inp.name] === true} onChange={(e) => setInputs({ ...inputs, [inp.name]: e.target.checked })} />
                  ) : (
                    <input
                      id={`run-input-${inp.name}`}
                      type={inp.type === 'number' ? 'number' : 'text'}
                      className={input}
                      value={inputs[inp.name] === undefined ? '' : String(inputs[inp.name])}
                      placeholder={inp.default !== undefined ? `Default: ${String(inp.default)}` : inp.description}
                      onChange={(e) => {
                        const next = { ...inputs };
                        if (e.target.value === '') delete next[inp.name];
                        else next[inp.name] = inp.type === 'number' ? Number(e.target.value) : e.target.value;
                        setInputs(next);
                      }}
                    />
                  )}
                </div>
              ))}
              <button type="button" className={btn.primary} onClick={() => void runNow()} disabled={!canRun || starting}>
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {starting ? 'Running…' : 'Run now'}
              </button>
              {whyNot && <p className="text-size-caption text-[var(--ink-3)]">{whyNot}</p>}
              {!whyNot && <p className="text-size-caption text-[var(--ink-3)]">This is a real run: agents and searches use live data and are billed.</p>}
            </section>

            <section aria-label="Past runs">
              <h3 className="mb-2 text-size-caption font-semibold uppercase tracking-wide text-[var(--ink-3)]">Past runs</h3>
              {runs === null ? (
                <p className="text-size-ui text-[var(--ink-3)]">Loading…</p>
              ) : runs.length === 0 ? (
                <p className="text-size-ui text-[var(--ink-3)]">No runs yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {runs.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => void open(r.id)} className="flex w-full items-center gap-2 rounded-xl border border-[var(--line-1)] px-3 py-2 text-left hover:bg-[var(--surface-2)]">
                        <Chip tone={TONE[r.status] ?? 'neutral'}>{label(r.status)}</Chip>
                        <span className="min-w-0 flex-1 truncate text-size-ui text-[var(--ink-1)]">{new Date(r.createdAt).toLocaleString()}</span>
                        <span className="text-size-caption text-[var(--ink-3)]">{usd(r.costUsd)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
