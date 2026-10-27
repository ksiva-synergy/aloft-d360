'use client';

import React from 'react';
import { Check, CheckCircle2, Circle, ExternalLink, Lightbulb, Loader2, Lock, Rocket, Sparkles } from 'lucide-react';
import type { ConstructionState } from '@/lib/construction/constructionState';
import { canCommissionAgent } from '@/lib/construction/readiness';
import type { EditableField } from '@/lib/construction/user-edits';
import { cn } from '@/lib/utils';
import { ClassPicker, DatasourceEditor, InlineText, ProvenanceBadge, ToolEditor, type SaveFn } from './config/FieldEditors';
import { FlowStrip } from './config/FlowStrip';
import { TestRunSection } from './config/TestRunSection';

interface ConfigPanelProps {
  state: ConstructionState | null;
  readiness: string | null;
  commissionResult: { catalogUrl: string } | null;
  /** When set, show the draft panel (empty rows) instead of the pre-session placeholder. */
  sessionId?: string | null;
  /** While the builder is streaming, fields are read-only (its end-of-turn write would race the edit). */
  isStreaming?: boolean;
  isCommissioning?: boolean;
  canCommission?: boolean;
  selectedModel?: string;
  /** Omit to render the panel read-only. */
  onEditField?: (field: EditableField, value: unknown) => Promise<string | null>;
  onCommission?: () => void;
  onTestRunRecorded?: (run: ConstructionState['validation']['lastTestRun']) => void;
}

const STAGES = ['interview', 'plan', 'build', 'validate', 'commission'] as const;
const MIN_INSTRUCTIONS = 40;

export function ConfigPanel({
  state,
  readiness,
  commissionResult,
  sessionId,
  isStreaming = false,
  isCommissioning = false,
  canCommission,
  selectedModel,
  onEditField,
  onCommission,
  onTestRunRecorded,
}: ConfigPanelProps) {
  if (!state && !sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
          <Sparkles className="h-5 w-5" />
        </span>
        <p className="text-[length:var(--type-body-size)] font-semibold text-[var(--ink-1)]">No draft yet</p>
        <p className="max-w-[260px] text-[length:var(--type-ui-regular-size)] leading-relaxed text-[var(--ink-3)]">
          Describe your agent in the chat. Its name, class, instructions and data appear here, and you can edit any of them.
        </p>
      </div>
    );
  }

  if (!state) return null;

  const commissioned = !!commissionResult || state.readiness === 'commission';
  const ready = canCommission ?? canCommissionAgent(state);
  const stage = (readiness ?? state.readiness ?? 'interview') as (typeof STAGES)[number];
  const stageIndex = Math.max(0, STAGES.indexOf(stage));
  const instructions = state.prompt.instructions?.trim() ?? '';
  const lastRun = state.validation.lastTestRun;
  const testPassed = !!lastRun && lastRun.outcome === 'completed' && lastRun.toolErrors === 0;

  const readOnly = !onEditField || isStreaming || !sessionId;
  const lockNote = isStreaming
    ? 'The builder is updating the draft. Editing unlocks when it finishes.'
    : commissioned
      ? 'Saved. Edits here update the agent the next time you use it.'
      : null;

  const saver = (field: EditableField): SaveFn => (value) =>
    onEditField ? onEditField(field, value) : Promise.resolve('Editing is not available here.');

  const checks = [
    { label: 'Name', done: !!state.name?.trim() },
    { label: 'Agent class', done: !!state.class?.id },
    { label: `Instructions (${MIN_INSTRUCTIONS}+ characters)`, done: instructions.length >= MIN_INSTRUCTIONS },
  ];

  const catalogSlug = commissionResult?.catalogUrl.split('/').pop();

  return (
    <div className="wb-draft flex-1 overflow-y-auto px-5 py-5 font-sans text-[var(--ink-1)]">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Agent blueprint</p>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[length:var(--type-caption-size)] font-semibold capitalize',
            commissioned || ready ? 'bg-[var(--ok-bg)] text-[var(--ok)]' : 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]',
          )}
        >
          {commissioned ? 'Commissioned' : stage}
        </span>
      </div>

      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <InlineText
            label="agent name"
            value={state.name?.trim() ?? ''}
            placeholder="Untitled agent"
            onSave={saver('name')}
            disabled={readOnly}
            displayClassName="text-[length:var(--type-title-section-size)] font-semibold leading-snug"
          />
        </div>
        <span className="mt-2"><ProvenanceBadge state={state} field="name" /></span>
      </div>

      {lockNote && (
        <p className="mt-2 flex items-center gap-1.5 rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[length:var(--type-caption-size)] text-[var(--ink-2)]">
          {isStreaming && <Lock className="h-3.5 w-3.5 shrink-0" />} {lockNote}
        </p>
      )}

      {/* ── Progress ───────────────────────────────────── */}
      <div className="mt-4" aria-label={`Stage ${stageIndex + 1} of ${STAGES.length}: ${stage}`}>
        <div className="flex gap-1">
          {STAGES.map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i <= stageIndex || commissioned ? 'bg-[var(--brand-a)]' : 'bg-[var(--line-1)]',
              )}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[length:var(--type-caption-size)] capitalize text-[var(--ink-3)]">
          {STAGES.map((s, i) => (
            <span key={s} className={cn(i === stageIndex && 'font-semibold text-[var(--ink-1)]')}>{s}</span>
          ))}
        </div>
      </div>

      {/* ── Flow ───────────────────────────────────────── */}
      <FlowStrip state={state} />

      {/* ── Status ─────────────────────────────────────── */}
      {commissioned ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[var(--ok-bg)] p-3.5">
          <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--ok)]" />
          <div className="min-w-0">
            <p className="text-[length:var(--type-ui-regular-size)] font-semibold text-[var(--ok)]">Agent saved</p>
            <p className="mt-0.5 text-[length:var(--type-caption-size)] leading-relaxed text-[var(--ink-2)]">
              You can use it, view it, and come back to edit it. It is listed under Agents.
            </p>
            {commissionResult && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {catalogSlug && (
                  <a href={`/agent-lab/agents/${encodeURIComponent(catalogSlug)}`} className="inline-flex items-center gap-1 text-[length:var(--type-ui-regular-size)] font-medium text-[var(--brand-a-ink)] hover:underline">
                    Use <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <a href={commissionResult.catalogUrl} className="inline-flex items-center gap-1 text-[length:var(--type-ui-regular-size)] font-medium text-[var(--brand-a-ink)] hover:underline">
                  View <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a href="/agent-lab/agents" className="inline-flex items-center gap-1 text-[length:var(--type-ui-regular-size)] font-medium text-[var(--brand-a-ink)] hover:underline">
                  All agents <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
        </div>
      ) : ready ? (
        <div className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[var(--ok-bg)] p-3.5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--ok)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[length:var(--type-ui-regular-size)] font-semibold text-[var(--ok)]">Ready to commission</p>
              <p className="mt-0.5 text-[length:var(--type-caption-size)] leading-relaxed text-[var(--ink-2)]">
                {testPassed
                  ? 'The last test run passed. Commission to save it to the catalog for review.'
                  : 'Run a test below first so you know it answers from real data.'}
              </p>
            </div>
          </div>
          {onCommission && (
            <button
              type="button"
              onClick={onCommission}
              disabled={isCommissioning || isStreaming}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ok)] px-3 text-[length:var(--type-caption-size)] font-semibold text-white disabled:opacity-60"
            >
              {isCommissioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              {isCommissioning ? 'Commissioning…' : testPassed ? 'Commission' : 'Commission without testing'}
            </button>
          )}
        </div>
      ) : (
        <ul className="mt-5 space-y-2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-3.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2.5 text-[length:var(--type-ui-regular-size)]">
              {c.done ? (
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ok)] text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              ) : (
                <Circle className="h-[18px] w-[18px] text-[var(--line-2)]" />
              )}
              <span className={c.done ? 'text-[var(--ink-2)]' : 'text-[var(--ink-1)]'}>{c.label}</span>
            </li>
          ))}
          <li className="flex items-center gap-2.5 text-[length:var(--type-ui-regular-size)]">
            {testPassed ? (
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ok)] text-white">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : (
              <Circle className="h-[18px] w-[18px] text-[var(--line-2)]" />
            )}
            <span className="text-[var(--ink-2)]">Test run <span className="text-[var(--ink-3)]">(recommended)</span></span>
          </li>
        </ul>
      )}

      {/* ── Purpose ────────────────────────────────────── */}
      <Section id="wb-sec-purpose" title="Purpose" badge={<ProvenanceBadge state={state} field="prompt.persona" />}>
        <InlineText
          label="purpose"
          value={state.prompt.persona ?? ''}
          placeholder="One line: who this agent helps and with what"
          onSave={saver('prompt.persona')}
          disabled={readOnly}
          displayClassName="text-[length:var(--type-ui-regular-size)] leading-relaxed text-[var(--ink-2)]"
        />
      </Section>

      {/* ── Class ──────────────────────────────────────── */}
      <Section id="wb-sec-class" title="Class" badge={<ProvenanceBadge state={state} field="class.id" />}>
        <ClassPicker value={state.class?.id ?? null} onSave={saver('class.id')} disabled={readOnly} />
      </Section>

      {/* ── Instructions ───────────────────────────────── */}
      <Section id="wb-sec-instructions" title="Instructions" badge={<ProvenanceBadge state={state} field="prompt.instructions" />}>
        <div className="rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3.5 py-2.5">
          <InlineText
            label="instructions"
            value={instructions}
            placeholder="Not written yet. Describe how the agent should work, step by step."
            onSave={saver('prompt.instructions')}
            disabled={readOnly}
            multiline
            minLength={MIN_INSTRUCTIONS}
            displayClassName="line-clamp-[12] whitespace-pre-wrap text-[length:var(--type-ui-regular-size)] leading-relaxed text-[var(--ink-2)]"
          />
        </div>
      </Section>

      {/* ── Data ───────────────────────────────────────── */}
      <Section
        id="wb-sec-data"
        title="Data sources"
        count={state.tools.datasources.length}
        badge={<ProvenanceBadge state={state} field="tools.datasources" />}
      >
        <DatasourceEditor items={state.tools.datasources} onSave={saver('tools.datasources')} disabled={readOnly} />
      </Section>

      {/* ── Tools ──────────────────────────────────────── */}
      <Section id="wb-sec-tools" title="Tools" count={state.tools.actions.length} badge={<ProvenanceBadge state={state} field="tools.actions" />}>
        <ToolEditor items={state.tools.actions} onSave={saver('tools.actions')} disabled={readOnly} />
      </Section>

      {/* ── Test run ───────────────────────────────────── */}
      <Section id="wb-sec-test" title="Test run">
        <TestRunSection
          sessionId={sessionId ?? null}
          state={state}
          model={selectedModel}
          disabled={isStreaming || !onEditField}
          onRecorded={onTestRunRecorded}
        />
      </Section>

      {/* ── Assumptions ────────────────────────────────── */}
      <Section title="Assumptions" count={state.assumptionLedger.length}>
        {state.assumptionLedger.length === 0 ? (
          <Empty>None recorded</Empty>
        ) : (
          <ul className="space-y-1.5">
            {state.assumptionLedger.map((a, i) => (
              <li key={`${a.field}-${i}`} className="rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />
                  <p className="min-w-0 flex-1 truncate text-[length:var(--type-caption-size)] font-medium">{humanize(a.field)}</p>
                  <StatusChip status={a.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-[length:var(--type-caption-size)] leading-relaxed text-[var(--ink-2)]">{formatValue(a.value)}</p>
                <div className="mt-1.5 flex items-center gap-2" title={`Confidence ${Math.round(a.confidence * 100)}%`}>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--line-1)]">
                    <span className="block h-full rounded-full bg-[var(--brand-a)]" style={{ width: `${Math.round(a.confidence * 100)}%` }} />
                  </span>
                  <span className="text-[length:var(--type-caption-size)] tabular-nums text-[var(--ink-3)]">{Math.round(a.confidence * 100)}%</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  count,
  badge,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-6 scroll-mt-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide text-[var(--ink-3)]">{title}</h3>
        {count !== undefined && (
          <span className="rounded-full bg-[var(--surface-3)] px-1.5 text-[length:var(--type-caption-size)] font-semibold tabular-nums text-[var(--ink-2)]">{count}</span>
        )}
        <span className="ml-auto">{badge}</span>
      </div>
      {children}
    </section>
  );
}

function StatusChip({ status }: { status: 'assumed' | 'confirmed' | 'corrected' }) {
  const tone =
    status === 'confirmed' ? 'bg-[var(--ok-bg)] text-[var(--ok)]'
    : status === 'corrected' ? 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]'
    : 'bg-[var(--warn-bg)] text-[var(--warn)]';
  return <span className={cn('shrink-0 rounded-full px-2 py-px text-[length:var(--type-caption-size)] font-semibold capitalize', tone)}>{status}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[length:var(--type-ui-regular-size)] italic text-[var(--ink-3)]">{children}</p>;
}

function humanize(field: string) {
  const last = field.split('.').pop() ?? field;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(formatValue).join(', ');
  try { return JSON.stringify(v); } catch { return String(v); }
}
