'use client';

import React, { useState } from 'react';
import { Check, CheckCircle2, Circle, Database, ExternalLink, Lightbulb, Sparkles } from 'lucide-react';
import type { ConstructionState } from '@/lib/construction/constructionState';
import { canCommissionAgent } from '@/lib/construction/readiness';
import { cn } from '@/lib/utils';

interface ConfigPanelProps {
  state: ConstructionState | null;
  readiness: string | null;
  commissionResult: { catalogUrl: string } | null;
  /** When set, show the draft panel (empty rows) instead of the pre-session placeholder. */
  sessionId?: string | null;
}

const STAGES = ['interview', 'plan', 'build', 'validate', 'commission'] as const;
const MIN_INSTRUCTIONS = 40;

export function ConfigPanel({ state, readiness, commissionResult, sessionId }: ConfigPanelProps) {
  if (!state && !sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
          <Sparkles className="h-5 w-5" />
        </span>
        <p className="text-[14px] font-semibold text-[var(--ink-1)]">No draft yet</p>
        <p className="max-w-[260px] text-[13px] leading-relaxed text-[var(--ink-3)]">
          Describe your agent in the chat. Name, class, instructions and datasources appear here as the builder saves them.
        </p>
      </div>
    );
  }

  if (!state) return null;

  const ready = canCommissionAgent(state);
  const stage = (readiness ?? state.readiness ?? 'interview') as (typeof STAGES)[number];
  const stageIndex = Math.max(0, STAGES.indexOf(stage));
  const instructions = state.prompt.instructions?.trim() ?? '';

  const checks = [
    { label: 'Name', done: !!state.name?.trim() },
    { label: 'Agent class', done: !!state.class?.id },
    { label: `Instructions (${MIN_INSTRUCTIONS}+ characters)`, done: instructions.length >= MIN_INSTRUCTIONS },
  ];

  return (
    <div className="wb-draft flex-1 overflow-y-auto px-5 py-5 font-sans text-[var(--ink-1)]">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-3)]">Agent draft</p>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold capitalize',
            commissionResult || ready ? 'bg-[var(--ok-bg)] text-[var(--ok)]' : 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]',
          )}
        >
          {commissionResult ? 'Commissioned' : stage}
        </span>
      </div>

      <h2 className="mt-2 text-[19px] font-semibold leading-snug">
        {state.name?.trim() || <span className="font-normal italic text-[var(--ink-3)]">Untitled agent</span>}
      </h2>
      {state.class?.id && (
        <span className="mt-2 inline-flex items-center rounded-md border border-[var(--line-1)] bg-[var(--surface-2)] px-2 py-0.5 text-[12px] font-medium text-[var(--ink-2)]">
          Class · {state.class.id}
        </span>
      )}

      {/* ── Progress ───────────────────────────────────── */}
      <div className="mt-5" aria-label={`Stage ${stageIndex + 1} of ${STAGES.length}: ${stage}`}>
        <div className="flex gap-1">
          {STAGES.map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i <= stageIndex || commissionResult ? 'bg-[var(--brand-a)]' : 'bg-[var(--line-1)]',
              )}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px] capitalize text-[var(--ink-3)]">
          {STAGES.map((s, i) => (
            <span key={s} className={cn(i === stageIndex && 'font-semibold text-[var(--ink-1)]')}>{s}</span>
          ))}
        </div>
      </div>

      {/* ── Status ─────────────────────────────────────── */}
      {commissionResult ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[var(--ok-bg)] p-3.5">
          <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--ok)]" />
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-[var(--ok)]">Agent commissioned</p>
            <a
              href={commissionResult.catalogUrl}
              className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--brand-a-ink)] hover:underline"
            >
              View in catalog <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      ) : ready ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[var(--ok-bg)] p-3.5">
          <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--ok)]" />
          <div>
            <p className="text-[13.5px] font-semibold text-[var(--ok)]">Ready to commission</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
              Press <strong className="font-semibold">Commission</strong> in the composer to publish this agent.
            </p>
          </div>
        </div>
      ) : (
        <ul className="mt-5 space-y-2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-3.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2.5 text-[13px]">
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
        </ul>
      )}

      {/* ── Instructions ───────────────────────────────── */}
      <Section title="Instructions">
        {instructions ? <Instructions text={instructions} /> : <Empty>Not written yet</Empty>}
      </Section>

      {/* ── Datasources ────────────────────────────────── */}
      <Section title="Datasources" count={state.tools.datasources.length}>
        {state.tools.datasources.length === 0 ? (
          <Empty>None connected</Empty>
        ) : (
          <ul className="space-y-1.5">
            {state.tools.datasources.map((d, i) => (
              <li key={`${d.kind}-${d.ref}-${i}`} className="flex items-center gap-2.5 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3 py-2">
                <Database className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{d.ref}</p>
                  {d.scope && <p className="truncate text-[11.5px] text-[var(--ink-3)]">{d.scope}</p>}
                </div>
                <span className="shrink-0 rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ink-2)]">
                  {d.kind}
                </span>
              </li>
            ))}
          </ul>
        )}
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
                  <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{humanize(a.field)}</p>
                  <StatusChip status={a.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-[var(--ink-2)]">{formatValue(a.value)}</p>
                <div className="mt-1.5 flex items-center gap-2" title={`Confidence ${Math.round(a.confidence * 100)}%`}>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--line-1)]">
                    <span className="block h-full rounded-full bg-[var(--brand-a)]" style={{ width: `${Math.round(a.confidence * 100)}%` }} />
                  </span>
                  <span className="text-[10.5px] tabular-nums text-[var(--ink-3)]">{Math.round(a.confidence * 100)}%</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-3)]">{title}</h3>
        {count !== undefined && (
          <span className="rounded-full bg-[var(--surface-3)] px-1.5 text-[10.5px] font-semibold tabular-nums text-[var(--ink-2)]">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Instructions({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;
  return (
    <div className="rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3.5 py-3">
      <p className={cn('whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--ink-2)]', !open && long && 'line-clamp-4')}>{text}</p>
      {long && (
        <button onClick={() => setOpen((o) => !o)} className="mt-1.5 text-[12px] font-medium text-[var(--brand-a-ink)] hover:underline">
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: 'assumed' | 'confirmed' | 'corrected' }) {
  const tone =
    status === 'confirmed' ? 'bg-[var(--ok-bg)] text-[var(--ok)]'
    : status === 'corrected' ? 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]'
    : 'bg-[var(--warn-bg)] text-[var(--warn)]';
  return <span className={cn('shrink-0 rounded-full px-2 py-px text-[10.5px] font-semibold capitalize', tone)}>{status}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] italic text-[var(--ink-3)]">{children}</p>;
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
