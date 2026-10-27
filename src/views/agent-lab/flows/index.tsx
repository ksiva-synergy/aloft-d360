'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Braces, Check, FlaskConical, Loader2, Plug, Plus, Save, Search, Sparkles, Upload, Workflow, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addStep, type Def } from '@/lib/flows/edit';
import type { FlowTemplate } from '@/lib/flows/templates';
import type { TemplateMatch } from '@/lib/flows/recommend';
import FlowCanvas, { type StepFindings } from './FlowCanvas';
import { StepEditor, WorkflowSettings } from './FlowForm';
import CopilotPanel, { type CopilotProposal } from './CopilotPanel';
import TestRunPanel, { verdict, type Drill, type Publishing, type TestResult } from './TestRunPanel';
import { Chip, Segmented, StepIcon, btn, pretty } from './ui';

// Flows builder. Home: describe a goal, reopen a saved workflow, or start from a template.
// Builder: canvas of the draft in the middle, an Edit / Copilot panel on the right, and a test-run
// drawer below. Every view edits the same JSON draft; checks, simulation and publishing are decided
// by /api/agent-lab/flows/* on the server.

type Catalog = { capabilities?: { id: string; title: string; fields?: Record<string, unknown> }[]; templates: FlowTemplate[]; matches: TemplateMatch[]; egress: { emailDomains: string[] }; publishing: Publishing };
type FlowSummary = { id: string; name: string; status: string; version?: number; owner: string; updatedAt: string };
type Saved = { id: string; version: number; status: string };
type Notice = { tone: 'ok' | 'bad'; text: string };

const DOMAIN_LABEL: Record<FlowTemplate['domain'], string> = {
  procurement: 'Procurement',
  finance: 'Finance',
  hr: 'HR',
  maritime: 'Maritime',
  integration: 'Custom API',
};

const BLANK: Def = { name: 'Untitled workflow', trigger: { type: 'manual' }, inputs: [], steps: [] };

const templateSteps = (t: FlowTemplate) => (t.definition.steps as { type: string }[] | undefined) ?? [];

async function readJson<T>(res: Response): Promise<T & { error?: string; details?: { code?: string } }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string; details?: { code?: string } };
}

function relativeDate(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString();
}

function StatusChip({ status, version }: { status?: string; version?: number }) {
  if (!status) return <Chip>Not saved</Chip>;
  return status === 'active' ? <Chip tone="ok">Published v{version}</Chip> : <Chip>Draft · v{version}</Chip>;
}

// ── Home ──────────────────────────────────────────────────────────────────────

function Home({
  catalog,
  flows,
  goalMessage,
  finding,
  onFind,
  onTemplate,
  onBlank,
  onOpen,
}: {
  catalog: Catalog | null;
  flows: FlowSummary[];
  goalMessage: string | null;
  finding: boolean;
  onFind: (goal: string) => void;
  onTemplate: (t: FlowTemplate) => void;
  onBlank: (goal?: string) => void;
  onOpen: (id: string) => void;
}) {
  const [goal, setGoal] = useState('');
  const [needGoal, setNeedGoal] = useState(false);
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center gap-2">
        <h1 className="text-size-kpi-lg font-semibold tracking-tight text-[var(--ink-1)]">Flows</h1>
        <Chip tone="brand">Preview</Chip>
      </div>
      <p className="mt-1 max-w-2xl text-size-body text-[var(--ink-3)]">
        Automate repeatable work across your data, people and systems. Every workflow is checked against your permissions and tested on sample data before it can be published.
      </p>

      <form
        className="mt-8 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (goal.trim()) onFind(goal.trim());
          else {
            setNeedGoal(true);
            document.getElementById('flow-goal')?.focus();
          }
        }}
      >
        <label htmlFor="flow-goal" className="text-size-body-lg font-semibold text-[var(--ink-1)]">
          What would you like to automate?
        </label>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-2)] px-3 focus-within:border-[var(--brand-a)] focus-within:bg-[var(--surface-1)]">
            <Search className="h-4 w-4 shrink-0 text-[var(--ink-3)]" aria-hidden />
            <input
              id="flow-goal"
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value);
                setNeedGoal(false);
              }}
              aria-describedby="flow-goal-help"
              placeholder="e.g. Chase suppliers when a purchase order is more than three days late"
              className="h-full w-full bg-transparent text-size-body text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
            />
          </div>
          <button type="submit" disabled={finding} className={cn(btn.primary, 'h-11 px-4')}>
            {finding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Start building
          </button>
          <button type="button" onClick={() => onBlank()} className={cn(btn.secondary, 'h-11 px-4')}>
            <Plus className="h-4 w-4" /> Blank workflow
          </button>
        </div>
        <p id="flow-goal-help" className={cn('mt-3 text-size-ui', goalMessage ? 'text-[var(--bad)]' : needGoal ? 'text-[var(--warn)]' : 'text-[var(--ink-3)]')} aria-live="polite">
          {goalMessage ??
            (needGoal
              ? 'Describe what you want to automate first, or start from a template below.'
              : 'Copilot starts from the closest template, or from scratch, and builds the steps for you to review.')}
        </p>
      </form>

      {flows.length > 0 && (
        <section aria-label="My workflows" className="mt-10">
          <h2 className="text-size-body font-semibold text-[var(--ink-1)]">My workflows</h2>
          <ul className="mt-3 divide-y divide-[var(--line-1)] overflow-hidden rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]">
            {flows.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => onOpen(f.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--ink-2)]">
                    <Workflow className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-size-ui font-medium text-[var(--ink-1)]">{f.name}</span>
                    <span className="block text-size-caption text-[var(--ink-3)]">Updated {relativeDate(f.updatedAt)}</span>
                  </span>
                  <StatusChip status={f.status} version={f.version ?? 1} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Templates" className="mt-10">
        <h2 className="text-size-body font-semibold text-[var(--ink-1)]">Start from a template</h2>
        {!catalog ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)]" />
            ))}
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onTemplate(t)}
                  className="group flex h-full w-full flex-col rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4 text-left transition-[border-color,box-shadow] hover:border-[color-mix(in_srgb,var(--brand-a)_55%,var(--line-1))] hover:shadow-md"
                >
                  <div className="flex items-center gap-1">
                    {templateSteps(t).slice(0, 6).map((s, i) => (
                      <StepIcon key={i} type={s.type} size="sm" />
                    ))}
                  </div>
                  <span className="mt-3 text-size-body font-semibold text-[var(--ink-1)]">{t.name}</span>
                  <span className="mt-1 line-clamp-2 text-size-ui text-[var(--ink-3)]">{t.summary}</span>
                  <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                    <Chip>{DOMAIN_LABEL[t.domain]}</Chip>
                    {templateSteps(t).some((s) => s.type === 'agent') && (
                      <Chip tone="brand">
                        <Sparkles className="h-3 w-3" /> AI
                      </Chip>
                    )}
                    <span className="text-size-caption text-[var(--ink-3)]">{templateSteps(t).length} steps</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Builder ───────────────────────────────────────────────────────────────────

export default function FlowsPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; disabled?: boolean } | null>(null);
  const [myFlows, setMyFlows] = useState<FlowSummary[]>([]);
  const [goalMessage, setGoalMessage] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);

  // The open workflow.
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [template, setTemplate] = useState<FlowTemplate | null>(null);
  const [definitionText, setDefinitionText] = useState('');
  const [savedText, setSavedText] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'canvas' | 'code'>('canvas');
  const [panel, setPanel] = useState<'edit' | 'copilot'>('edit');
  const [copilotSeed, setCopilotSeed] = useState<string | undefined>();
  const [proposal, setProposal] = useState<CopilotProposal | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, 'applied' | 'discarded'>>({});

  // Testing.
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [fixtures, setFixtures] = useState<Record<string, unknown>>({});
  const [drill, setDrill] = useState<Drill | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | 'save' | 'publish'>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadMyFlows = useCallback(async () => {
    const res = await fetch('/api/agent-lab/flows');
    const data = await readJson<{ flows?: FlowSummary[] }>(res);
    if (res.ok) setMyFlows(data.flows ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/agent-lab/flows/catalog');
      const data = await readJson<Catalog>(res);
      if (cancelled) return;
      if (!res.ok) setLoadError({ message: data.error ?? 'Could not load Flows', disabled: data.details?.code === 'flows_disabled' });
      else {
        setCatalog(data);
        void loadMyFlows();
      }
    })().catch(() => !cancelled && setLoadError({ message: 'Could not reach the server' }));
    return () => {
      cancelled = true;
    };
  }, [loadMyFlows]);

  const parsedDef = useMemo<{ ok: true; def: Def } | { ok: false; error: string }>(() => {
    try {
      const def = JSON.parse(definitionText) as Def;
      if (def === null || typeof def !== 'object' || Array.isArray(def)) return { ok: false, error: 'not an object' };
      return { ok: true, def };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'invalid' };
    }
  }, [definitionText]);
  const def = parsedDef.ok ? parsedDef.def : null;
  const dirty = savedText === null || savedText !== definitionText;
  const stale = !!result && resultText !== definitionText;
  const selectedStep = def?.steps?.find((s) => s.id === selectedId) ?? null;

  const openWorkspace = (opts: { text: string; saved: Saved | null; template: FlowTemplate | null; inputs: Record<string, unknown>; fixtures: Record<string, unknown>; panel?: 'edit' | 'copilot'; seed?: string }) => {
    setDefinitionText(opts.text);
    setSavedText(opts.saved ? opts.text : null);
    setSaved(opts.saved);
    setTemplate(opts.template);
    setInputValues(opts.inputs);
    setFixtures(opts.fixtures);
    setSelectedId(null);
    setView('canvas');
    setPanel(opts.panel ?? 'edit');
    setCopilotSeed(opts.seed);
    setProposal(null);
    setOutcomes({});
    setDrill(null);
    setResult(null);
    setResultText(null);
    setRequestError(null);
    setNotice(null);
    setSession((n) => n + 1);
    setOpen(true);
  };

  const chooseTemplate = (t: FlowTemplate, seed?: string) =>
    openWorkspace({ text: pretty(t.definition), saved: null, template: t, inputs: { ...t.sampleInputs }, fixtures: { ...t.fixtures }, panel: seed ? 'copilot' : 'edit', seed });

  const startBlank = (seed?: string) => openWorkspace({ text: pretty(BLANK), saved: null, template: null, inputs: {}, fixtures: {}, panel: 'copilot', seed: seed || undefined });

  /** Opens the closest template (or a blank workflow) and sends the goal to Copilot straight away. */
  const findForGoal = async (goal: string) => {
    setGoalMessage(null);
    setFinding(true);
    try {
      const res = await fetch(`/api/agent-lab/flows/catalog?goal=${encodeURIComponent(goal)}`);
      const data = await readJson<Catalog>(res);
      if (!res.ok) return setGoalMessage(data.error ?? `Could not look up templates (${res.status}).`);
      const best = catalog?.templates.find((t) => t.id === data.matches[0]?.templateId);
      if (best) {
        chooseTemplate(best, goal);
        setNotice({ tone: 'ok', text: `Started from “${best.name}”. Copilot is tailoring it to your goal.` });
      } else {
        startBlank(goal);
        setNotice({ tone: 'ok', text: 'No template is close, so Copilot is building this from scratch.' });
      }
    } catch {
      setGoalMessage('Could not reach the server.');
    } finally {
      setFinding(false);
    }
  };

  const openSaved = async (id: string) => {
    const res = await fetch(`/api/agent-lab/flows/${id}`);
    const data = await readJson<{ flow?: { id: string; version: number; status: string; definition: unknown } }>(res);
    if (!res.ok || !data.flow) return setGoalMessage(data.error ?? 'Could not open that workflow');
    const d = data.flow.definition as Def;
    const inputs = Object.fromEntries((d.inputs ?? []).filter((i) => i.default !== undefined).map((i) => [i.name, i.default]));
    openWorkspace({ text: pretty(d), saved: { id: data.flow.id, version: data.flow.version, status: data.flow.status }, template: null, inputs, fixtures: {} });
  };

  const backToHome = () => {
    if (dirty && typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('Leave without saving? Your changes to this workflow will be lost.')) return;
    setOpen(false);
    setGoalMessage(null);
    void loadMyFlows();
  };

  const applyProposal = (p: CopilotProposal) => {
    setDefinitionText(pretty(p.definition));
    setProposal(null);
    setOutcomes((o) => ({ ...o, [p.id]: 'applied' }));
  };
  const discardProposal = (p: CopilotProposal) => {
    setProposal(null);
    setOutcomes((o) => ({ ...o, [p.id]: 'discarded' }));
  };

  /** Every edit goes through here. A pending copilot proposal is dropped once the draft changes. */
  const editDef = (next: Def) => {
    setProposal(null);
    setDefinitionText(pretty(next));
  };

  const runTest = async () => {
    setRequestError(null);
    if (!def) return setRequestError('The code view has a JSON error. Fix it first.');
    setDrawerOpen(true);
    setRunning(true);
    const text = definitionText;
    try {
      const res = await fetch('/api/agent-lab/flows/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition: def,
          inputs: inputValues,
          fixtures,
          faults: drill ? { [drill.stepId]: { failAttempts: drill.mode === 'once' ? 1 : 6, message: 'Failure drill: simulated outage' } } : undefined,
        }),
      });
      const data = await readJson<TestResult>(res);
      if (res.ok || res.status === 422) {
        setResult(data);
        setResultText(text);
      } else setRequestError(data.error ?? `Request failed (${res.status})`);
    } catch {
      setRequestError('Could not reach the server');
    } finally {
      setRunning(false);
    }
  };

  const saveWorkflow = async () => {
    setNotice(null);
    if (!def) return setNotice({ tone: 'bad', text: 'The code view has a JSON error. Fix it before saving.' });
    setBusy('save');
    const text = definitionText;
    try {
      const res = saved
        ? await fetch(`/api/agent-lab/flows/${saved.id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def, baseVersion: saved.version }) })
        : await fetch('/api/agent-lab/flows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
      const data = await readJson<{ flow?: { id: string; version: number; status: string }; details?: { issues?: { path: string; message: string }[]; latestVersion?: number } }>(res);
      if (!res.ok || !data.flow) {
        const issues = data.details?.issues?.map((i) => `${i.path || '(root)'} ${i.message}`).join('; ');
        return setNotice({
          tone: 'bad',
          text: res.status === 409 ? 'This workflow was changed elsewhere. Reopen it from My workflows to get the latest version.' : issues ? `Not saved: ${issues}` : data.error ?? 'Could not save',
        });
      }
      setSaved({ id: data.flow.id, version: data.flow.version ?? 1, status: data.flow.status });
      setSavedText(text);
      setNotice({ tone: 'ok', text: `Saved as version ${data.flow.version}.` });
      void loadMyFlows();
    } catch {
      setNotice({ tone: 'bad', text: 'Could not reach the server' });
    } finally {
      setBusy(null);
    }
  };

  const publishWorkflow = async (unpublish = false) => {
    if (!saved) return;
    setNotice(null);
    setBusy('publish');
    try {
      const res = await fetch(
        `/api/agent-lab/flows/${saved.id}/publish`,
        unpublish ? { method: 'DELETE' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: saved.version, inputs: inputValues, fixtures }) },
      );
      const data = await readJson<{ flow?: { status: string }; details?: { findings?: { message: string }[]; error?: string } }>(res);
      if (!res.ok || !data.flow) {
        const why = data.details?.findings?.map((f) => f.message).join('; ') ?? data.details?.error;
        return setNotice({ tone: 'bad', text: `Not published: ${why ?? data.error ?? 'failed'}` });
      }
      setSaved({ ...saved, status: data.flow.status });
      setNotice({ tone: 'ok', text: unpublish ? 'Returned to draft.' : `Version ${saved.version} is published.` });
      void loadMyFlows();
    } catch {
      setNotice({ tone: 'bad', text: 'Could not reach the server' });
    } finally {
      setBusy(null);
    }
  };

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (busy === null) void saveWorkflow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <Plug className="mx-auto h-8 w-8 text-[var(--ink-3)]" />
        <p className="mt-3 text-size-body font-medium text-[var(--ink-1)]">{loadError.disabled ? 'Flows is not switched on here' : 'Flows could not load'}</p>
        <p className="mx-auto mt-1 max-w-md text-size-body text-[var(--ink-3)]">
          {loadError.disabled ? 'An administrator can enable the preview by setting FLOWS_ENABLED=true for the API server.' : loadError.message}
        </p>
      </div>
    );
  }

  if (!open) {
    return <Home catalog={catalog} flows={myFlows} goalMessage={goalMessage} finding={finding} onFind={(g) => void findForGoal(g)} onTemplate={(t) => chooseTemplate(t)} onBlank={startBlank} onOpen={(id) => void openSaved(id)} />;
  }

  // What the canvas shows: the pending proposal when there is one, otherwise the draft.
  const shown = proposal?.definition ?? def;
  const findingsSource = proposal ? proposal.findings : result?.ok && !stale ? result.findings : [];
  const findingsByStep: Record<string, StepFindings> = {};
  for (const f of findingsSource) {
    if (!f.stepId) continue;
    const x = (findingsByStep[f.stepId] ??= { errors: 0, warnings: 0 });
    if (f.severity === 'error') x.errors++;
    else x.warnings++;
  }
  const runStatus = !proposal && !stale && result?.ok && result.simulation ? Object.fromEntries(result.simulation.steps.map((s) => [s.stepId, s.status])) : undefined;
  const v = stale ? null : verdict(result);
  const removedNames = proposal ? proposal.diff.removed.map((id) => def?.steps?.find((s) => s.id === id)?.name ?? id) : [];

  return (
    <div className="flex h-full min-h-[560px] flex-col bg-[var(--main-bg)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line-1)] bg-[var(--surface-1)] px-3">
        <button type="button" onClick={backToHome} className={btn.ghost} aria-label="Back to all workflows">
          <ArrowLeft className="h-4 w-4" /> Workflows
        </button>
        <span className="h-5 w-px bg-[var(--line-1)]" aria-hidden />
        <button type="button" onClick={() => setSelectedId(null)} className="min-w-0 truncate text-size-body font-semibold text-[var(--ink-1)] hover:text-[var(--brand-a)]" title="Workflow settings">
          {def?.name || 'Untitled workflow'}
        </button>
        <StatusChip status={saved?.status} version={saved?.version} />
        {saved && <span className={cn('inline-flex items-center gap-1 text-size-caption', dirty ? 'text-[var(--warn)]' : 'text-[var(--ink-3)]')}>
          {dirty ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" aria-hidden /> Unsaved changes
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden /> Saved
            </>
          )}
        </span>}
        <span className="flex-1" />
        {v && (
          <button type="button" onClick={() => setDrawerOpen(true)} className="hidden lg:inline-flex">
            <Chip tone={v.tone}>{v.text}</Chip>
          </button>
        )}
        <Segmented
          label="Editor view"
          value={view}
          onChange={setView}
          options={[
            { value: 'canvas', label: <><Workflow className="h-3.5 w-3.5" aria-hidden /> Canvas</> },
            { value: 'code', label: <><Braces className="h-3.5 w-3.5" aria-hidden /> Code</> },
          ]}
        />
        <button type="button" onClick={() => void runTest()} disabled={running} className={btn.secondary}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Test
        </button>
        <button type="button" onClick={() => void saveWorkflow()} disabled={busy !== null || (!!saved && !dirty)} className={btn.secondary} title="Ctrl+S">
          {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {saved ? 'Save new version' : 'Save workflow'}
        </button>
        {saved && saved.status !== 'active' && (
          <button type="button" onClick={() => void publishWorkflow()} disabled={busy !== null || dirty} title={dirty ? 'Save your changes first' : 'Checks and a simulated run must pass'} className={btn.primary}>
            {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Publish v{saved.version}
          </button>
        )}
        {saved?.status === 'active' && (
          <button type="button" onClick={() => void publishWorkflow(true)} disabled={busy !== null} className={btn.ghost}>
            Unpublish
          </button>
        )}
      </header>

      {notice && (
        <div role="status" className={cn('flex items-start gap-2 border-b px-4 py-2 text-size-ui', notice.tone === 'ok' ? 'border-[var(--ok-bg)] bg-[var(--ok-bg)] text-[var(--ok)]' : 'border-[var(--bad-bg)] bg-[var(--bad-bg)] text-[var(--bad)]')}>
          <span className="flex-1">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {view === 'code' ? (
              <div className="flex h-full flex-col p-3">
                <label htmlFor="flow-definition" className="sr-only">
                  Flow definition JSON
                </label>
                <textarea
                  id="flow-definition"
                  value={definitionText}
                  onChange={(e) => {
                    setProposal(null);
                    setDefinitionText(e.target.value);
                  }}
                  spellCheck={false}
                  className="h-full w-full flex-1 resize-none rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-3 font-mono text-size-caption text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]"
                />
              </div>
            ) : shown ? (
              <>
                <FlowCanvas
                  def={shown}
                  selectedId={proposal ? null : selectedId}
                  onSelect={(id) => {
                    if (proposal) return;
                    setSelectedId(id);
                    setPanel('edit');
                  }}
                  onAddAfter={
                    proposal || !def
                      ? undefined
                      : (after, type) => {
                          const next = addStep(def, type, after ?? undefined);
                          editDef(next);
                          setSelectedId(next.steps!.find((s) => !def.steps?.some((x) => x.id === s.id))!.id);
                          setPanel('edit');
                        }
                  }
                  runStatus={runStatus}
                  findings={findingsByStep}
                  diff={proposal?.diff}
                  topInset={proposal ? 56 : 0}
                />
                {proposal && (
                  <div className="absolute inset-x-3 top-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--brand-a)] bg-[var(--surface-1)] px-3 py-2 shadow-md">
                    <Sparkles className="h-4 w-4 text-[var(--brand-a)]" aria-hidden />
                    <span className="text-size-ui font-semibold text-[var(--ink-1)]">Previewing Copilot’s proposal</span>
                    <span className="text-size-caption text-[var(--ink-3)]">
                      {proposal.changes.length} change{proposal.changes.length === 1 ? '' : 's'}
                      {removedNames.length > 0 && ` · removes ${removedNames.join(', ')}`}
                    </span>
                    <span className="flex-1" />
                    <button type="button" className={btn.ghost} onClick={() => discardProposal(proposal)}>
                      Discard
                    </button>
                    <button type="button" className={btn.primary} onClick={() => applyProposal(proposal)}>
                      <Check className="h-3.5 w-3.5" /> Apply
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <p className="max-w-md rounded-xl bg-[var(--warn-bg)] px-4 py-3 text-size-ui text-[var(--warn)]">
                  The JSON is not valid ({!parsedDef.ok && parsedDef.error}), so the canvas and form are unavailable. Fix it in the code view.
                </p>
              </div>
            )}
          </div>

          <TestRunPanel
            def={def}
            open={drawerOpen}
            onToggle={() => setDrawerOpen(!drawerOpen)}
            inputValues={inputValues}
            onInputValues={setInputValues}
            drill={drill}
            onDrill={setDrill}
            running={running}
            onRun={() => void runTest()}
            result={result}
            stale={stale}
            requestError={requestError}
            emailDomains={catalog?.egress.emailDomains ?? []}
          />
        </div>

        <aside aria-label="Workflow panel" className="flex w-[380px] shrink-0 flex-col border-l border-[var(--line-1)] bg-[var(--surface-1)] xl:w-[420px]">
          <div className="flex h-11 shrink-0 items-center border-b border-[var(--line-1)] px-3">
            <Segmented
              label="Panel"
              value={panel}
              onChange={setPanel}
              options={[
                { value: 'edit', label: selectedStep ? 'Step' : 'Settings' },
                { value: 'copilot', label: <><Sparkles className="h-3.5 w-3.5" aria-hidden /> Copilot</> },
              ]}
            />
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto', panel !== 'edit' && 'hidden')}>
            {!def ? (
              <p className="m-4 rounded-xl bg-[var(--warn-bg)] px-3 py-2 text-size-ui text-[var(--warn)]">Fix the JSON in the code view to edit here.</p>
            ) : proposal ? (
              <p className="m-4 rounded-xl bg-[var(--brand-a-soft)] px-3 py-2 text-size-ui text-[var(--brand-a-ink)]">Apply or discard Copilot’s proposal to keep editing.</p>
            ) : selectedStep ? (
              <StepEditor
                key={selectedStep.id}
                step={selectedStep}
                def={def}
                onChange={(next) => {
                  editDef(next);
                  if (!next.steps?.some((s) => s.id === selectedStep.id)) setSelectedId(null);
                }}
                onClose={() => setSelectedId(null)}
                capabilities={catalog?.capabilities ?? []}
                fixture={fixtures[selectedStep.id]}
                onFixture={(value) =>
                  setFixtures((f) => {
                    const next = { ...f };
                    if (value === undefined) delete next[selectedStep.id];
                    else next[selectedStep.id] = value;
                    return next;
                  })
                }
                findings={findingsSource.filter((f) => f.stepId === selectedStep.id)}
              />
            ) : (
              <WorkflowSettings def={def} onChange={editDef} bindings={template?.bindings} />
            )}
          </div>
          <div className={cn('min-h-0 flex-1', panel !== 'copilot' && 'hidden')}>
            <CopilotPanel
              key={session}
              def={def}
              seed={copilotSeed}
              pendingId={proposal?.id ?? null}
              outcomes={outcomes}
              onPropose={(p) => {
                setProposal(p);
                setView('canvas');
              }}
              onApply={applyProposal}
              onDiscard={discardProposal}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
