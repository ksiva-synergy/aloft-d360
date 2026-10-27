'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import {
  OPERATORS,
  STEP_TYPE_LABEL,
  TRANSFORM_OPS,
  coerceDefault,
  removeStep,
  renameStep,
  setBudget,
  setInputs,
  setTrigger,
  setWhen,
  updateStep,
  updateStepConfig,
  type Def,
  type InputDef,
  type Step,
} from './editor-model';
import { StepIcon, btn } from './ui';

// Side-panel editors over the same JSON definition the API validates: workflow settings, and one
// step at a time. Every change calls `onChange` with a new definition; validity and policy are
// always decided on the server.

type Capabilities = { id: string; title: string; fields?: Record<string, unknown> }[];
type ConnectionOption = { id: string; name: string; kind: string; status: string; mine?: boolean; ownerName?: string | null };

const field = 'h-8 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';
const area = 'w-full resize-y rounded-lg border border-[var(--line-1)] bg-[var(--surface-2)] p-2 font-mono text-size-caption text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-size-caption font-medium text-[var(--ink-2)]">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-size-caption text-[var(--ink-3)]">{hint}</p>}
    </div>
  );
}

/** A JSON object edited as text; applies on blur so half-typed JSON never replaces the definition. */
function JsonField({ id, value, onCommit, rows = 6 }: { id: string; value: unknown; onCommit: (v: Record<string, unknown>) => void; rows?: number }) {
  const serialized = JSON.stringify(value ?? {}, null, 2);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  // Follow changes made elsewhere (the JSON view, an accepted copilot proposal).
  const [shown, setShown] = useState(serialized);
  if (shown !== serialized) {
    setShown(serialized);
    setText(serialized);
    setError(null);
  }
  return (
    <>
      <textarea
        id={id}
        value={text}
        rows={rows}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const parsed = JSON.parse(text || '{}');
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a JSON object');
            setError(null);
            onCommit(parsed as Record<string, unknown>);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'invalid JSON');
          }
        }}
        className={area}
      />
      {error && <p className="mt-1 text-size-caption text-[var(--bad)]">Not applied: {error}</p>}
    </>
  );
}

/**
 * Picks one of the user's connections (their own, or one shared with the organisation) for an
 * operation that takes a `connection`. Stores the connection id. Reuse comes first; adding a new
 * one opens the Connections page in a new tab, so the draft here is not lost.
 */
function ConnectionPicker({ id, value, onChange }: { id: string; value: string; onChange: (id: string) => void }) {
  const [list, setList] = useState<ConnectionOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/connections');
      const data = (await res.json().catch(() => ({}))) as { connections?: ConnectionOption[] };
      if (cancelled) return;
      setFailed(!res.ok);
      setList(res.ok ? (data.connections ?? []) : []);
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

  const mine = (list ?? []).filter((c) => c.mine !== false);
  const shared = (list ?? []).filter((c) => c.mine === false);
  const label = (c: ConnectionOption) => `${c.name}${c.status === 'error' ? ' (failing)' : c.status === 'untested' ? ' (not tested)' : ''}`;
  const known = (list ?? []).some((c) => c.id === value);
  return (
    <>
      <select id={id} className={field} value={value} disabled={!list} onChange={(e) => onChange(e.target.value)}>
        <option value="">{list ? 'Choose a connection…' : 'Loading connections…'}</option>
        {value && list && !known && <option value={value}>{value} (not available to you)</option>}
        {mine.length > 0 && (
          <optgroup label="Yours">
            {mine.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
          </optgroup>
        )}
        {shared.length > 0 && (
          <optgroup label="Shared with you">
            {shared.map((c) => <option key={c.id} value={c.id}>{label(c)}{c.ownerName ? ` · ${c.ownerName}` : ''}</option>)}
          </optgroup>
        )}
      </select>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-size-caption text-[var(--ink-3)]">
        {failed ? 'Could not load your connections.' : list && list.length === 0 ? 'You have no connections yet.' : 'Use one you already have before adding another.'}
        <a href="/agent-staging/connections" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--brand-a)] hover:underline">
          Manage connections <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </p>
    </>
  );
}

function StepConfig({ step, def, onChange, capabilities }: { step: Step; def: Def; onChange: (d: Def) => void; capabilities: Capabilities }) {
  const c = step.config as Record<string, any>;
  const set = (patch: Record<string, unknown>) => onChange(updateStepConfig(def, step.id, patch));
  const k = (name: string) => `${step.id}-${name}`;

  switch (step.type) {
    case 'query':
      return (
        <div className="space-y-3">
          <Field id={k('mode')} label="Source">
            <select id={k('mode')} className={field} value={c.sql !== undefined ? 'sql' : 'semantic'} onChange={(e) => onChange(updateStep(def, step.id, { config: e.target.value === 'sql' ? { sql: 'select 1', maxRows: c.maxRows ?? 1000 } : { semantic: { modelId: '', entityId: '', dimensions: [], measures: [], filters: [], sorts: [] }, maxRows: c.maxRows ?? 1000 } }))}>
              <option value="semantic">Governed semantic query (recommended)</option>
              <option value="sql">Raw read-only SQL (needs the flow:sql permission)</option>
            </select>
          </Field>
          {c.sql !== undefined ? (
            <Field id={k('sql')} label="SQL">
              <textarea id={k('sql')} rows={4} className={area} spellCheck={false} value={c.sql} onChange={(e) => set({ sql: e.target.value })} />
            </Field>
          ) : (
            <Field id={k('semantic')} label="Semantic query" hint="Model, entity, dimensions, measures, filters and sorts, by id.">
              <JsonField id={k('semantic')} value={c.semantic} onCommit={(v) => set({ semantic: v })} rows={8} />
            </Field>
          )}
          <Field id={k('maxRows')} label="Row limit">
            <input id={k('maxRows')} type="number" min={1} max={10000} className={field} value={c.maxRows ?? 1000} onChange={(e) => set({ maxRows: Number(e.target.value) })} />
          </Field>
        </div>
      );
    case 'retrieve':
      return (
        <div className="grid gap-3 grid-cols-[1fr_5rem]">
          <Field id={k('query')} label="Search for">
            <input id={k('query')} className={field} value={c.query ?? ''} onChange={(e) => set({ query: e.target.value })} />
          </Field>
          <Field id={k('topK')} label="Results">
            <input id={k('topK')} type="number" min={1} max={50} className={field} value={c.topK ?? 5} onChange={(e) => set({ topK: Number(e.target.value) })} />
          </Field>
        </div>
      );
    case 'agent':
      return (
        <div className="space-y-3">
          <div className="grid gap-3 grid-cols-2">
            <Field id={k('agentSlug')} label="Agent" hint="Slug of a saved agent. Blank = plain prompt, no tools.">
              <input id={k('agentSlug')} className={field} value={c.agentSlug ?? ''} onChange={(e) => set({ agentSlug: e.target.value || undefined })} />
            </Field>
            <Field id={k('model')} label="Model" hint="Blank = default.">
              <input id={k('model')} className={field} value={c.model ?? ''} onChange={(e) => set({ model: e.target.value || undefined })} />
            </Field>
          </div>
          <Field id={k('prompt')} label="Prompt" hint="Use {{steps.<id>.<field>}} and {{inputs.<name>}}. Data from steps is treated as data, not instructions.">
            <textarea id={k('prompt')} rows={5} className={area} value={c.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} />
          </Field>
        </div>
      );
    case 'transform':
      return (
        <div className="space-y-3">
          <Field id={k('op')} label="Operation">
            <select id={k('op')} className={field} value={c.op} onChange={(e) => onChange(updateStep(def, step.id, { config: e.target.value === 'filter' ? { op: 'filter', input: c.input ?? '', field: '', operator: 'eq', value: '' } : e.target.value === 'limit' ? { op: 'limit', input: c.input ?? '', count: 10 } : e.target.value === 'count' ? { op: 'count', input: c.input ?? '' } : { op: 'anti_join', input: c.input ?? '', other: '', key: '' } }))}>
              {TRANSFORM_OPS.map((o) => (
                <option key={o} value={o}>
                  {o === 'filter' ? 'Keep rows where…' : o === 'limit' ? 'Keep the first N rows' : o === 'count' ? 'Count rows' : 'Rows with no match in another list'}
                </option>
              ))}
            </select>
          </Field>
          <Field id={k('input')} label="Rows" hint="A reference, e.g. {{steps.query_1.rows}}">
            <input id={k('input')} className={`${field} font-mono`} value={c.input ?? ''} onChange={(e) => set({ input: e.target.value })} />
          </Field>
          {c.op === 'filter' && (
            <div className="grid gap-3 grid-cols-3">
              <Field id={k('field')} label="Field">
                <input id={k('field')} className={field} value={c.field ?? ''} onChange={(e) => set({ field: e.target.value })} />
              </Field>
              <Field id={k('operator')} label="Operator">
                <select id={k('operator')} className={field} value={c.operator} onChange={(e) => set({ operator: e.target.value })}>
                  {OPERATORS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field id={k('value')} label="Value">
                <input id={k('value')} className={field} value={String(c.value ?? '')} onChange={(e) => set({ value: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} />
              </Field>
            </div>
          )}
          {c.op === 'limit' && (
            <Field id={k('count')} label="Rows to keep">
              <input id={k('count')} type="number" min={1} className={field} value={c.count ?? 10} onChange={(e) => set({ count: Number(e.target.value) })} />
            </Field>
          )}
          {c.op === 'anti_join' && (
            <div className="grid gap-3 grid-cols-3">
              <Field id={k('other')} label="Other list">
                <input id={k('other')} className={`${field} font-mono`} value={c.other ?? ''} onChange={(e) => set({ other: e.target.value })} />
              </Field>
              <Field id={k('key')} label="Key in rows">
                <input id={k('key')} className={field} value={c.key ?? ''} onChange={(e) => set({ key: e.target.value })} />
              </Field>
              <Field id={k('otherKey')} label="Key in other list" hint="Blank = same key">
                <input id={k('otherKey')} className={field} value={c.otherKey ?? ''} onChange={(e) => set({ otherKey: e.target.value || undefined })} />
              </Field>
            </div>
          )}
        </div>
      );
    case 'approval':
      return (
        <div className="space-y-3">
          <Field id={k('assignee')} label="Approver email" hint="Blank = the automation owner.">
            <input id={k('assignee')} type="email" className={field} value={c.assignee ?? ''} onChange={(e) => set({ assignee: e.target.value || undefined })} />
          </Field>
          <Field id={k('message')} label="Message to the approver">
            <textarea id={k('message')} rows={3} className={area} value={c.message ?? ''} onChange={(e) => set({ message: e.target.value })} />
          </Field>
        </div>
      );
    case 'output':
      return (
        <div className="space-y-3">
          <Field id={k('title')} label="Title">
            <input id={k('title')} className={field} value={c.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field id={k('content')} label="Content">
            <textarea id={k('content')} rows={3} className={area} value={c.content ?? ''} onChange={(e) => set({ content: e.target.value })} />
          </Field>
        </div>
      );
    case 'tool':
      return (
        <div className="space-y-3">
          <Field id={k('capability')} label="Connector operation" hint="Connection, method and channel must be fixed values, not references.">
            <select id={k('capability')} className={field} value={c.capability} onChange={(e) => set({ capability: e.target.value, version: undefined })}>
              {!capabilities.some((x) => x.id === c.capability) && <option value={c.capability}>{c.capability}</option>}
              {capabilities.map((x) => <option key={x.id} value={x.id}>{x.title} ({x.id})</option>)}
            </select>
          </Field>
          {capabilities.find((x) => x.id === c.capability)?.fields?.connection !== undefined && (
            <Field id={k('connection')} label="Connection">
              <ConnectionPicker id={k('connection')} value={typeof c.input?.connection === 'string' ? c.input.connection : ''} onChange={(v) => set({ input: { ...(c.input ?? {}), connection: v } })} />
            </Field>
          )}
          <Field id={k('input')} label="Inputs">
            <JsonField id={k('input')} value={c.input ?? {}} onCommit={(v) => set({ input: v })} rows={7} />
          </Field>
        </div>
      );
    default:
      return <p className="text-size-ui text-[var(--ink-3)]">This step type has no form yet. Use the JSON tab.</p>;
  }
}


function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-[var(--line-1)] px-4 py-4 first:border-t-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-size-caption font-semibold uppercase tracking-wide text-[var(--ink-3)]">{title}</h3>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export type StepFinding = { severity: 'error' | 'warning'; message: string };

/** Workflow-level settings, shown when no step is selected. */
export function WorkflowSettings({ def, onChange, bindings }: { def: Def; onChange: (next: Def) => void; bindings?: string[] }) {
  const inputs = def.inputs ?? [];
  const trigger = def.trigger ?? { type: 'manual' };
  const patchInput = (i: number, patch: Partial<InputDef>) => onChange(setInputs(def, inputs.map((x, n) => (n === i ? { ...x, ...patch } : x))));

  return (
    <div>
      <Section title="Automation">
        <Field id="flow-name" label="Name">
          <input id="flow-name" className={field} value={def.name ?? ''} onChange={(e) => onChange({ ...def, name: e.target.value })} />
        </Field>
        <Field id="flow-description" label="Description">
          <textarea id="flow-description" rows={2} className={`${field} h-auto py-1.5`} value={def.description ?? ''} onChange={(e) => onChange({ ...def, description: e.target.value || undefined })} />
        </Field>
      </Section>

      <Section title="When it runs">
        <Field id="trigger-type" label="Trigger">
          <select id="trigger-type" className={field} value={trigger.type} onChange={(e) => onChange(setTrigger(def, e.target.value))}>
            <option value="manual">Someone starts it</option>
            <option value="schedule">On a schedule</option>
            <option value="webhook">When an external system calls it</option>
            <option value="event">When an ALOFT event is raised</option>
          </select>
        </Field>
        {trigger.type === 'schedule' && (
          <Field id="trigger-cron" label="Schedule (cron, UTC)" hint="Five fields, e.g. 0 6 * * 1 = Mondays 06:00. A test run lists the next run times.">
            <input id="trigger-cron" className={`${field} font-mono`} value={trigger.cron ?? ''} onChange={(e) => onChange({ ...def, trigger: { type: 'schedule', cron: e.target.value } })} />
          </Field>
        )}
        {(trigger.type === 'webhook' || trigger.type === 'event') && (
          <Field id="trigger-name" label={trigger.type === 'webhook' ? 'Webhook name' : 'Event name'}>
            <input id="trigger-name" className={field} value={trigger.name ?? ''} onChange={(e) => onChange({ ...def, trigger: { type: trigger.type, name: e.target.value } })} />
          </Field>
        )}
      </Section>

      <Section
        title="Inputs"
        aside={
          <button type="button" onClick={() => onChange(setInputs(def, [...inputs, { name: `input_${inputs.length + 1}`, type: 'string', required: true }]))} className={btn.ghost}>
            <Plus className="h-3.5 w-3.5" /> Add input
          </button>
        }
      >
        {inputs.length === 0 && <p className="text-size-ui text-[var(--ink-3)]">No inputs. Add one to make the automation reusable, then reference it as {'{{inputs.name}}'}.</p>}
        {inputs.map((inp, i) => (
          <div key={i} className="rounded-lg border border-[var(--line-1)] p-2.5">
            <div className="grid grid-cols-[1fr_6.5rem_auto] items-end gap-2">
              <Field id={`inp-${i}-name`} label="Name">
                <input id={`inp-${i}-name`} className={`${field} font-mono`} value={inp.name} onChange={(e) => patchInput(i, { name: e.target.value })} />
              </Field>
              <Field id={`inp-${i}-type`} label="Type">
                <select id={`inp-${i}-type`} className={field} value={inp.type} onChange={(e) => patchInput(i, { type: e.target.value as InputDef['type'], default: undefined })}>
                  <option>string</option>
                  <option>number</option>
                  <option>boolean</option>
                </select>
              </Field>
              <button type="button" aria-label={`Remove input ${inp.name}`} className={`${btn.icon} mb-0.5`} onClick={() => onChange(setInputs(def, inputs.filter((_, n) => n !== i)))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2">
              <Field id={`inp-${i}-default`} label="Default">
                <input id={`inp-${i}-default`} className={field} value={inp.default === undefined ? '' : String(inp.default)} onChange={(e) => patchInput(i, { default: coerceDefault(inp.type, e.target.value) })} />
              </Field>
              <label className="mb-1.5 inline-flex items-center gap-1.5 text-size-caption text-[var(--ink-2)]">
                <input type="checkbox" checked={inp.required !== false} onChange={(e) => patchInput(i, { required: e.target.checked })} /> Required
              </label>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Limits">
        <Field id="flow-budget" label="Budget per run (USD)" hint="The run stops before a paid call that would exceed this.">
          <input id="flow-budget" type="number" min={0} step="0.01" className={field} value={def.budget?.maxCostUsd ?? ''} placeholder="No budget" onChange={(e) => onChange(setBudget(def, e.target.value === '' ? undefined : Number(e.target.value)))} />
        </Field>
      </Section>

      {bindings && bindings.length > 0 && (
        <Section title="Before publishing, bind">
          <ul className="list-disc space-y-1 pl-5 text-size-ui text-[var(--ink-2)]">
            {bindings.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Steps whose output is mocked in a test run, so a sample response makes the test realistic. */
const MOCKED_TYPES = new Set(['query', 'retrieve', 'agent', 'tool']);

/** Everything about one step: what it does, when it runs, how it recovers, and its sample response. */
export function StepEditor({
  step,
  def,
  onChange,
  onClose,
  capabilities,
  fixture,
  onFixture,
  findings = [],
}: {
  step: Step;
  def: Def;
  onChange: (next: Def) => void;
  onClose: () => void;
  capabilities: Capabilities;
  fixture?: unknown;
  onFixture: (value: Record<string, unknown> | undefined) => void;
  findings?: StepFinding[];
}) {
  // The parent keys this editor by step id, so a rename remounts it with a fresh draft.
  const [idDraft, setIdDraft] = useState(step.id);
  const others = (def.steps ?? []).filter((s) => s.id !== step.id);
  const when = step.when;

  return (
    <div>
      <div className="flex items-start gap-3 border-b border-[var(--line-1)] px-4 py-3">
        <StepIcon type={step.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-size-body font-semibold text-[var(--ink-1)]">{step.name || step.id}</p>
          <p className="text-size-caption text-[var(--ink-3)]">{STEP_TYPE_LABEL[step.type] ?? step.type}</p>
        </div>
        <button type="button" aria-label={`Remove ${step.id}`} title="Remove step" className={btn.icon} onClick={() => onChange(removeStep(def, step.id))}>
          <Trash2 className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Close step" title="Back to automation settings" className={btn.icon} onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {findings.length > 0 && (
        <ul className="space-y-1.5 px-4 pt-3">
          {findings.map((f, n) => (
            <li key={n} className={`flex gap-2 rounded-lg px-2.5 py-2 text-size-caption ${f.severity === 'error' ? 'bg-[var(--bad-bg)] text-[var(--bad)]' : 'bg-[var(--warn-bg)] text-[var(--warn)]'}`}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">{f.severity === 'error' ? 'Blocks publishing: ' : 'Warning: '}</span>
                {f.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Section title="Basics">
        <Field id={`${step.id}-name`} label="Display name">
          <input id={`${step.id}-name`} className={field} value={step.name ?? ''} onChange={(e) => onChange(updateStep(def, step.id, { name: e.target.value || undefined }))} />
        </Field>
        <Field id={`${step.id}-id`} label="Step id" hint="Used in references such as {{steps.id.rows}}. Renaming updates every reference.">
          <input
            id={`${step.id}-id`}
            className={`${field} font-mono`}
            value={idDraft}
            onChange={(e) => setIdDraft(e.target.value)}
            onBlur={() => {
              if (/^[a-z][a-z0-9_]{0,39}$/.test(idDraft) && !others.some((s) => s.id === idDraft)) onChange(renameStep(def, step.id, idDraft));
              else setIdDraft(step.id);
            }}
          />
        </Field>
      </Section>

      <Section title="Settings">
        <StepConfig step={step} def={def} onChange={onChange} capabilities={capabilities} />
      </Section>

      <Section title="When it runs">
        <Field id={`${step.id}-after`} label="Runs after" hint="Referencing another step's output adds it automatically.">
          <div className="flex flex-wrap gap-1.5" id={`${step.id}-after`}>
            {others.length === 0 && <span className="text-size-caption text-[var(--ink-3)]">No other steps</span>}
            {others.map((o) => {
              const on = step.dependsOn?.includes(o.id) ?? false;
              return (
                <label key={o.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-size-caption focus-within:ring-2 focus-within:ring-[var(--brand-a-soft)] ${on ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]' : 'border-[var(--line-1)] text-[var(--ink-2)]'}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(updateStep(def, step.id, { dependsOn: on ? step.dependsOn!.filter((d) => d !== o.id) : [...(step.dependsOn ?? []), o.id] }))} />
                  {o.name || o.id}
                </label>
              );
            })}
          </div>
        </Field>
        <label className="inline-flex items-center gap-2 text-size-ui text-[var(--ink-1)]">
          <input type="checkbox" checked={!!when} onChange={(e) => onChange(setWhen(def, step.id, e.target.checked ? { ref: '{{inputs.x}}', operator: 'eq', value: '' } : undefined))} />
          Only run this step if…
        </label>
        {when && (
          <div className="grid grid-cols-3 gap-2">
            <Field id={`${step.id}-wref`} label="Value">
              <input id={`${step.id}-wref`} className={`${field} font-mono`} value={when.ref} onChange={(e) => onChange(setWhen(def, step.id, { ...when, ref: e.target.value }))} />
            </Field>
            <Field id={`${step.id}-wop`} label="Is">
              <select id={`${step.id}-wop`} className={field} value={when.operator} onChange={(e) => onChange(setWhen(def, step.id, { ...when, operator: e.target.value }))}>
                {OPERATORS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field id={`${step.id}-wval`} label="Compared with">
              <input id={`${step.id}-wval`} className={field} value={String(when.value)} onChange={(e) => onChange(setWhen(def, step.id, { ...when, value: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value }))} />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Reliability">
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${step.id}-retries`} label="Retries" hint="Extra attempts (0–5).">
            <input id={`${step.id}-retries`} type="number" min={0} max={5} className={field} value={step.retries ?? 0} onChange={(e) => onChange(updateStep(def, step.id, { retries: Number(e.target.value) }))} />
          </Field>
          <Field id={`${step.id}-timeout`} label="Timeout (seconds)">
            <input id={`${step.id}-timeout`} type="number" min={1} max={300} className={field} value={Math.round((step.timeoutMs ?? 60000) / 1000)} onChange={(e) => onChange(updateStep(def, step.id, { timeoutMs: Number(e.target.value) * 1000 }))} />
          </Field>
        </div>
      </Section>

      {MOCKED_TYPES.has(step.type) && (
        <Section title="Sample response for tests">
          <Field id={`${step.id}-fixture`} label="Sample response" hint="What this step returns in a test run. Not saved with the automation. Leave empty for an empty result.">
            <JsonField id={`${step.id}-fixture`} value={fixture ?? {}} rows={5} onCommit={(v) => onFixture(Object.keys(v).length ? v : undefined)} />
          </Field>
        </Section>
      )}
    </div>
  );
}
