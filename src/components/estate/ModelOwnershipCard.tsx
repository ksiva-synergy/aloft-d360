'use client';

/**
 * Ownership & refresh card for a Power BI model (Estate → Power BI → model header).
 * Who owns it, who can change it, where its data comes from, and — first — how fresh it is:
 * a stale dataset makes every parity mismatch a freshness question, not a SQL question.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

import { useJson } from '@/components/estate/ModelDependencyGraph';
import { Tag, type Tone } from '@/components/estate/object-ui';
import type { PbiOwnership } from '@/lib/powerbi/pbi-ownership';

const DAY = 86_400_000;

function age(iso: string | null): { text: string; days: number } | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const days = ms / DAY;
  const text =
    days < 1 / 24
      ? 'minutes ago'
      : days < 1
        ? `${Math.round(days * 24)} h ago`
        : days < 60
          ? `${Math.round(days)} days ago`
          : `${Math.round(days / 30.4)} months ago`;
  return { text, days };
}

function freshness(o: PbiOwnership): { tone: Tone; label: string; title: string } {
  const a = age(o.refresh.last_success_at);
  if (!a) return { tone: 'neutral', label: 'Refresh unknown', title: 'No completed refresh in the recent history' };
  if (a.days <= 2) return { tone: 'green', label: `Fresh · ${a.text}`, title: 'Last successful refresh' };
  if (a.days <= 30) return { tone: 'amber', label: `Refreshed ${a.text}`, title: 'Warehouse may hold newer rows than the dataset' };
  return {
    tone: 'red',
    label: `Stale · ${a.text}`,
    title: 'Dataset not refreshed for over a month — parity against current warehouse data measures staleness, not SQL',
  };
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-caption">
      <span className="w-32 shrink-0 text-[var(--estate-text-muted)]">{label}</span>
      <span className="min-w-0 flex-1 text-[var(--estate-text-secondary)]">{children}</span>
    </div>
  );
}

export function ModelOwnershipCard({ modelId }: { modelId: string }) {
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(false);
  const url = `/api/agent-lab/powerbi/models/${encodeURIComponent(modelId)}/ownership${nonce ? `?refresh=1&n=${nonce}` : ''}`;
  const { data, error, loading } = useJson<{ ownership: PbiOwnership }>(url);
  const o = data?.ownership;

  if (loading && !o) {
    return (
      <p className="flex items-center gap-2 text-caption text-[var(--estate-text-muted)]">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading ownership and refresh…
      </p>
    );
  }
  if (error || !o) {
    return <p className="text-caption text-[var(--estate-text-muted)]">Ownership unavailable{error ? `: ${error}` : ''}</p>;
  }

  const f = freshness(o);
  const editors = o.access.workspace.filter((u) => u.right === 'Admin' || u.right === 'Member' || u.right === 'Contributor');
  const viewers = o.access.workspace.filter((u) => u.right === 'Viewer');
  const last = o.refresh.last;
  const sched = o.refresh.schedule;

  return (
    <section
      aria-label="Ownership and refresh"
      className="rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-ui font-medium text-[var(--estate-ink)]"
        >
          {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          Ownership &amp; refresh
        </button>
        <span title={f.title}>
          <Tag tone={f.tone}>{f.label}</Tag>
        </span>
        {last?.status === 'Failed' && <Tag tone="red">Last refresh failed</Tag>}
        {sched && !sched.enabled && <Tag tone="amber">No scheduled refresh</Tag>}
        <span className="text-caption text-[var(--estate-text-muted)]">
          Owner <span className="text-[var(--estate-ink)]">{o.dataset.configured_by ?? 'unknown'}</span>
          {editors.length > 0 && <> · {editors.length} can edit</>}
        </span>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="ml-auto inline-flex items-center gap-1 text-caption text-[var(--estate-text-muted)] hover:text-[var(--estate-ink)]"
          title={`Fetched ${fmtDate(o.fetched_at)} — refetch from Power BI`}
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-[var(--estate-border)] pt-2">
          <Row label="Dataset owner">
            {o.dataset.configured_by ?? 'unknown'}
            {o.dataset.created_date && <> · created {fmtDate(o.dataset.created_date)}</>}
            {o.dataset.storage_mode && <> · {o.dataset.storage_mode}</>}
          </Row>
          <Row label="Last refresh">
            {last ? (
              <>
                <span className={last.status === 'Failed' ? 'text-[var(--estate-status-error-text)]' : ''}>{last.status}</span>
                {last.type && <> · {last.type}</>} · {fmtDate(last.end ?? last.start)}
                {last.error && <span className="block text-[var(--estate-status-error-text)]">{last.error}</span>}
              </>
            ) : (
              'no refresh history'
            )}
            {o.refresh.recent_failures > 0 && (
              <span className="block">
                {o.refresh.recent_failures} of the last {o.refresh.recent_count} refreshes failed
              </span>
            )}
          </Row>
          <Row label="Last success">{fmtDate(o.refresh.last_success_at)}</Row>
          <Row label="Schedule">
            {!sched
              ? 'unknown'
              : !sched.enabled
                ? 'Scheduled refresh is off'
                : `${sched.days.length === 7 ? 'Daily' : sched.days.join(', ') || 'Daily'} at ${sched.times.join(', ') || '—'}${sched.time_zone ? ` (${sched.time_zone})` : ''}`}
          </Row>
          <Row label="Data sources">
            {o.sources.length
              ? o.sources.map((s, i) => (
                  <span key={i} className="block">
                    {s.type}
                    {s.server && <> · <span className="font-mono">{s.server}</span></>}
                    {s.database && <> · {s.database}</>}
                    {s.gateway && <> · via gateway</>}
                  </span>
                ))
              : '—'}
          </Row>
          <Row label="Can edit">
            {editors.length
              ? editors.map((u) => `${u.name} (${u.right}${u.type !== 'User' ? `, ${u.type}` : ''})`).join(' · ')
              : '—'}
          </Row>
          <Row label="Viewers">
            {viewers.length} workspace viewer{viewers.length === 1 ? '' : 's'}
            {o.access.dataset.length > 0 && <> · {o.access.dataset.length} with direct dataset permission</>}
          </Row>
          {o.reports.length > 0 && (
            <Row label="Reports">
              {o.reports.map((r) =>
                r.web_url ? (
                  <a key={r.name} href={r.web_url} target="_blank" rel="noopener noreferrer" className="mr-3 inline-flex items-center gap-1 underline-offset-2 hover:underline">
                    {r.name} <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  <span key={r.name} className="mr-3">{r.name}</span>
                ),
              )}
            </Row>
          )}
          <p className="pt-1 text-[11px] text-[var(--estate-text-dim)]">
            Report author (created / last modified by) is only exposed by the Fabric admin scanner API, which needs a
            tenant administrator.
            {o.unavailable.length > 0 && <> Not readable with current permissions: {o.unavailable.join(', ')}.</>}
          </p>
        </div>
      )}
    </section>
  );
}
