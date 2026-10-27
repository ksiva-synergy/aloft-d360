'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleSlash, FlaskConical, Loader2, Play, Sparkles, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlowAnalysis } from '@/lib/flows/analyze';
import type { SimulatedStep } from '@/lib/flows/simulate';
import type { Def } from '@/lib/flows/edit';
import { Chip, Segmented, StepIcon, pretty, usd } from './ui';

// Test run drawer: typed inputs generated from the workflow's declared inputs, an optional failure
// drill, and the result of a check + simulated run (mocked connections, nothing sent).

export type Publishing = { available: boolean; reason: string };
export type TestResult = FlowAnalysis & { publishing: Publishing };
export type Drill = { stepId: string; mode: 'once' | 'always' };

type Props = {
  def: Def | null;
  open: boolean;
  onToggle: () => void;
  inputValues: Record<string, unknown>;
  onInputValues: (v: Record<string, unknown>) => void;
  drill: Drill | null;
  onDrill: (d: Drill | null) => void;
  running: boolean;
  onRun: () => void;
  result: TestResult | null;
  /** The draft changed after this result was produced. */
  stale: boolean;
  requestError: string | null;
  emailDomains: string[];
};

const field = 'h-8 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

function StepStatus({ step }: { step: SimulatedStep }) {
  if (step.status === 'succeeded') return <CheckCircle2 aria-label="Succeeded" className="h-4 w-4 shrink-0 text-[var(--ok)]" />;
  if (step.status === 'failed') return <XCircle aria-label="Failed" className="h-4 w-4 shrink-0 text-[var(--bad)]" />;
  return <CircleSlash aria-label={step.status} className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />;
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-size-caption text-[var(--ink-3)] hover:text-[var(--ink-2)]">{label}</summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[var(--surface-2)] p-2 font-mono text-size-caption text-[var(--ink-2)]">{pretty(value)}</pre>
    </details>
  );
}

/** One-line verdict for the header and the drawer bar. */
export function verdict(result: TestResult | null): { tone: 'ok' | 'warn' | 'bad'; text: string } | null {
  if (!result) return null;
  if (!result.ok) return { tone: 'bad', text: 'Not valid' };
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  if (result.readyToPublish) return { tone: 'ok', text: 'Ready to publish' };
  if (errors) return { tone: 'bad', text: `${errors} blocking` };
  return { tone: 'warn', text: result.simulation?.status === 'failed' ? 'Test failed' : 'Test incomplete' };
}

export default function TestRunPanel({ def, open, onToggle, inputValues, onInputValues, drill, onDrill, running, onRun, result, stale, requestError, emailDomains }: Props) {
  const [tab, setTab] = useState<'run' | 'checks' | 'summary'>('run');
  const inputs = def?.inputs ?? [];
  const stepIds = (def?.steps ?? []).map((s) => s.id);
  const ok = result?.ok ? result : null;
  const errors = ok?.findings.filter((f) => f.severity === 'error') ?? [];
  const warnings = ok?.findings.filter((f) => f.severity === 'warning') ?? [];
  const stepName = (id: string) => ok?.flow.steps.find((x) => x.id === id)?.name ?? id;
  const v = verdict(result);

  return (
    <section aria-label="Test run" className="flex min-h-0 flex-col border-t border-[var(--line-1)] bg-[var(--surface-1)]">
      <div className="flex h-10 shrink-0 items-center gap-3 px-3">
        <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1.5 text-size-ui font-semibold text-[var(--ink-1)]">
          <FlaskConical className="h-4 w-4 text-[var(--ink-3)]" aria-hidden /> Test run {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        {v && <Chip tone={stale ? 'neutral' : v.tone}>{stale ? 'Out of date: run again' : v.text}</Chip>}
        {ok?.simulation && !stale && <span className="text-size-caption text-[var(--ink-3)]">Simulated cost {usd(ok.simulation.totals.costUsd)}</span>}
        <span className="flex-1" />
        <span className="hidden text-size-caption text-[var(--ink-3)] md:inline">Sample data and mocked connections. Nothing is sent.</span>
      </div>

      {open && (
        <div className="grid h-[min(360px,45vh)] min-h-0 grid-cols-[minmax(240px,300px)_1fr] border-t border-[var(--line-1)]">
          <div className="min-h-0 space-y-3 overflow-y-auto border-r border-[var(--line-1)] p-3">
            <p className="text-size-caption font-semibold uppercase tracking-wide text-[var(--ink-3)]">Inputs</p>
            {inputs.length === 0 && <p className="text-size-ui text-[var(--ink-3)]">This automation has no inputs.</p>}
            {inputs.map((inp) => {
              const id = `test-input-${inp.name}`;
              const value = inputValues[inp.name];
              return (
                <div key={inp.name}>
                  {inp.type === 'boolean' ? (
                    <label className="inline-flex items-center gap-2 text-size-ui text-[var(--ink-1)]">
                      <input id={id} type="checkbox" checked={value === true} onChange={(e) => onInputValues({ ...inputValues, [inp.name]: e.target.checked })} />
                      {inp.name}
                    </label>
                  ) : (
                    <>
                      <label htmlFor={id} className="mb-1 block text-size-caption font-medium text-[var(--ink-2)]">
                        {inp.name}
                        {inp.required !== false && <span className="text-[var(--bad)]"> *</span>}
                      </label>
                      <input
                        id={id}
                        type={inp.type === 'number' ? 'number' : 'text'}
                        className={field}
                        value={value === undefined ? '' : String(value)}
                        placeholder={inp.default !== undefined ? `Default: ${String(inp.default)}` : inp.description}
                        onChange={(e) => {
                          const next = { ...inputValues };
                          if (e.target.value === '') delete next[inp.name];
                          else next[inp.name] = inp.type === 'number' ? Number(e.target.value) : e.target.value;
                          onInputValues(next);
                        }}
                      />
                    </>
                  )}
                </div>
              );
            })}

            <div className="border-t border-[var(--line-1)] pt-3">
              <label htmlFor="drill-step" className="mb-1 block text-size-caption font-medium text-[var(--ink-2)]">
                Failure drill
              </label>
              <select id="drill-step" value={drill?.stepId ?? ''} onChange={(e) => onDrill(e.target.value ? { stepId: e.target.value, mode: drill?.mode ?? 'always' } : null)} className={field}>
                <option value="">None</option>
                {stepIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              {drill && (
                <select aria-label="Failure mode" value={drill.mode} onChange={(e) => onDrill({ ...drill, mode: e.target.value as Drill['mode'] })} className={cn(field, 'mt-2')}>
                  <option value="once">fails once, then recovers</option>
                  <option value="always">fails every attempt</option>
                </select>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setTab('run');
                onRun();
              }}
              disabled={running || !def}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-a)] px-3 text-size-ui font-semibold text-white disabled:opacity-60"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run test
            </button>
            {requestError && <p className="rounded-lg bg-[var(--bad-bg)] px-2.5 py-2 text-size-caption text-[var(--bad)]">{requestError}</p>}
          </div>

          <div className="flex min-h-0 flex-col" aria-live="polite">
            {!result && (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-size-ui text-[var(--ink-3)]">
                Run a test to check the automation against your permissions and see how a run would go, step by step.
              </div>
            )}

            {result && !result.ok && (
              <div className="min-h-0 overflow-y-auto p-3">
                <p className="text-size-ui font-semibold text-[var(--bad)]">The definition is not valid</p>
                <ul className="mt-2 space-y-1">
                  {result.issues.map((i, n) => (
                    <li key={n} className="text-size-ui text-[var(--ink-2)]">
                      <span className="font-mono text-[var(--bad)]">{i.path || '(root)'}</span> {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ok && (
              <>
                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--line-1)] px-3 py-2">
                  <div className={cn('flex min-w-0 flex-1 items-center gap-2 text-size-ui', ok.readyToPublish ? 'text-[var(--ok)]' : errors.length ? 'text-[var(--bad)]' : 'text-[var(--warn)]')}>
                    {ok.readyToPublish ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                    <span className="font-semibold">
                      {ok.readyToPublish
                        ? 'Passes every check and the simulated run succeeded.'
                        : errors.length
                          ? `${errors.length} issue(s) would block publishing.`
                          : `The simulated run ${ok.simulation?.status === 'failed' ? 'failed' : 'did not finish'}.`}
                    </span>
                  </div>
                  <Segmented
                    label="Test result view"
                    value={tab}
                    onChange={setTab}
                    options={[
                      { value: 'run', label: 'Run' },
                      { value: 'checks', label: `Checks${errors.length + warnings.length ? ` (${errors.length + warnings.length})` : ''}` },
                      { value: 'summary', label: 'Summary' },
                    ]}
                  />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {tab === 'run' && ok.simulation && (
                    <div aria-label="Simulated run">
                      <ol className="space-y-3">
                        {ok.simulation.steps.map((s) => (
                          <li key={s.stepId} className="flex gap-3">
                            <StepStatus step={s} />
                            <div className="min-w-0 flex-1 text-size-ui">
                              <p className="flex flex-wrap items-center gap-x-2 text-[var(--ink-1)]">
                                <StepIcon type={s.type} size="sm" />
                                <span className="font-medium">{stepName(s.stepId)}</span>
                                <span className="text-size-caption text-[var(--ink-3)]">
                                  {s.status}
                                  {s.attempts > 1 ? ` · ${s.attempts} attempts` : ''}
                                  {s.mocked ? ' · mocked' : ''}
                                </span>
                              </p>
                              {s.effect && <p className="mt-0.5 text-[var(--ink-2)]">Would: {s.effect}</p>}
                              {s.skipReason && <p className="mt-0.5 text-[var(--ink-3)]">Skipped: {s.skipReason}</p>}
                              {s.error && <p className="mt-0.5 text-[var(--bad)]">{s.error}</p>}
                              <JsonDetails label="Input" value={s.input} />
                              <JsonDetails label="Output" value={s.output} />
                            </div>
                          </li>
                        ))}
                      </ol>
                      <p className="mt-3 text-size-caption text-[var(--ink-3)]">{ok.simulation.notice}</p>
                    </div>
                  )}

                  {tab === 'checks' && (
                    <div aria-label="Checks">
                      {errors.length + warnings.length === 0 && <p className="text-size-ui text-[var(--ok)]">No issues found.</p>}
                      <ul className="space-y-1.5">
                        {[...errors, ...warnings].map((f, n) => (
                          <li key={n} className="flex items-start gap-2 text-size-ui">
                            <Chip tone={f.severity === 'error' ? 'bad' : 'warn'}>{f.severity === 'error' ? 'Blocks publish' : 'Warning'}</Chip>
                            <span className="text-[var(--ink-2)]">
                              {f.stepId && <span className="font-medium text-[var(--ink-1)]">{stepName(f.stepId)}: </span>}
                              {f.message}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {tab === 'summary' && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-size-ui font-semibold text-[var(--ink-1)]">What it will do</h3>
                          {ok.explanation.kind === 'hybrid' ? (
                            <Chip tone="brand">
                              <Sparkles className="h-3 w-3" /> Uses AI
                            </Chip>
                          ) : (
                            <Chip>Deterministic</Chip>
                          )}
                        </div>
                        <p className="mt-1 text-size-ui text-[var(--ink-2)]">{ok.explanation.trigger}</p>
                        {ok.explanation.nextRuns.length > 0 && <p className="mt-1 text-size-caption text-[var(--ink-3)]">Next runs: {ok.explanation.nextRuns.map((r) => new Date(r).toLocaleString()).join(' · ')}</p>}
                        <ol className="mt-2 space-y-1.5">
                          {ok.explanation.steps.map((s, n) => (
                            <li key={s.id} className="flex gap-2 text-size-ui">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-size-caption font-semibold text-[var(--ink-2)]">{n + 1}</span>
                              <span className="text-[var(--ink-2)]">
                                <span className="font-medium text-[var(--ink-1)]">{stepName(s.id)}</span> — {s.does}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="space-y-3">
                        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-[var(--surface-2)] p-3 text-size-ui">
                          <div>
                            <dt className="text-size-caption text-[var(--ink-3)]">Expected cost</dt>
                            <dd className="font-semibold text-[var(--ink-1)]">{usd(ok.cost.expectedUsd)}</dd>
                          </div>
                          <div>
                            <dt className="text-size-caption text-[var(--ink-3)]">With all retries</dt>
                            <dd className="font-semibold text-[var(--ink-1)]">{usd(ok.cost.worstCaseUsd)}</dd>
                          </div>
                          <div>
                            <dt className="text-size-caption text-[var(--ink-3)]">Budget</dt>
                            <dd className="font-semibold text-[var(--ink-1)]">{ok.cost.budgetUsd !== undefined ? usd(ok.cost.budgetUsd) : '—'}</dd>
                          </div>
                        </dl>
                        <dl className="space-y-2 text-size-ui">
                          <div>
                            <dt className="text-size-caption text-[var(--ink-3)]">Permissions it needs</dt>
                            <dd className="mt-1 flex flex-wrap gap-1.5">{ok.explanation.access.permissions.map((p) => <Chip key={p}>{p}</Chip>)}</dd>
                          </div>
                          <div>
                            <dt className="text-size-caption text-[var(--ink-3)]">Connections</dt>
                            <dd className="mt-1 flex flex-wrap gap-1.5">{ok.explanation.access.connections.length ? ok.explanation.access.connections.map((c) => <Chip key={c}>{c}</Chip>) : <span className="text-[var(--ink-3)]">None</span>}</dd>
                          </div>
                          <div>
                            <dt className="text-size-caption text-[var(--ink-3)]">Approvals</dt>
                            <dd className="mt-1 text-[var(--ink-2)]">{ok.explanation.approvals.length ? ok.explanation.approvals.map((a) => `${stepName(a.stepId)} (${a.approver})`).join(', ') : 'None'}</dd>
                          </div>
                          <div>
                            <dt className="text-size-caption text-[var(--ink-3)]">Email allowed to</dt>
                            <dd className="mt-1 text-[var(--ink-2)]">{emailDomains.join(', ') || 'No domains (all email refused)'}</dd>
                          </div>
                        </dl>
                        <div>
                          <p className="text-size-caption text-[var(--ink-3)]">Limitations</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-size-caption text-[var(--ink-2)]">
                            {ok.explanation.limitations.map((l) => (
                              <li key={l}>{l}</li>
                            ))}
                          </ul>
                        </div>
                        <p className="text-size-caption text-[var(--ink-3)]">AI steps are priced at list rates for an assumed 6k input and 1k output tokens. {ok.publishing.reason}</p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
