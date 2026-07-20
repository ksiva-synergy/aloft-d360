'use client';

/**
 * TeachDigest — Teach Phase 3, the READ-ONLY candidate hand-off surface.
 *
 * Renders the typed candidate feed (GET /api/inspector/teach/candidates) as the
 * boundary between Teach and Build: the candidate list, a "ready to hand off"
 * count, honest per-candidate state, and an INERT "Open in Build →" marker.
 *
 * THE HAND-OFF IS INERT BY CONSTRUCTION. The "Open in Build →" affordance carries
 * NO state-mutating handler — there is no promote/commit path behind it. Reviewing,
 * resolving, and committing to governed memory is Build, a separate step. This
 * component only READS; it never captures, verifies, resolves, promotes, or credits.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck, GitCompare, CircleDot, CheckCircle2, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const SANS = "'Inter Tight', sans-serif";
const MONO = "'IBM Plex Mono', monospace";

type TeachCandidateState = 'proposed' | 'verified' | 'conflict' | 'resolved';
type LearningType =
  | 'metric_definition' | 'enterprise_convention' | 'estate_navigation' | 'vocabulary_entity' | 'other';

interface VerificationResult {
  ok: boolean;
  state: 'confirmed' | 'unconfirmed' | 'not_verifiable';
  rowCount?: number;
  reason?: string;
}
interface ConflictInfo { existingMemoryId: string; existingStatement: string; note?: string }
interface ConflictResolution { choice: string; scopeNote?: string; resolvedAt: string }

interface TeachCandidate {
  id: string;
  type: LearningType;
  statement: string;
  state: TeachCandidateState;
  verification_result: VerificationResult | null;
  conflict: ConflictInfo | null;
  resolution: ConflictResolution | null;
  author: string;
  sessionId: string | null;
  capturedAt: string;
}
interface TeachFeed {
  candidates: TeachCandidate[];
  readyCount: number;
  conflictCount: number;
  total: number;
}

const TYPE_LABEL: Record<LearningType, string> = {
  metric_definition: 'Metric',
  enterprise_convention: 'Convention',
  estate_navigation: 'Estate',
  vocabulary_entity: 'Vocabulary',
  other: 'Other',
};

const STATE_META: Record<TeachCandidateState, { label: string; cls: string; Icon: typeof CircleDot }> = {
  proposed: { label: 'Proposed', cls: 'text-sky-600 dark:text-sky-400', Icon: CircleDot },
  verified: { label: 'Verified', cls: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
  conflict: { label: 'Conflict', cls: 'text-amber-600 dark:text-amber-400', Icon: GitCompare },
  resolved: { label: 'Resolved', cls: 'text-violet-600 dark:text-violet-400', Icon: ShieldCheck },
};

export function TeachDigest({ sessionId }: { sessionId?: string }) {
  const [feed, setFeed] = useState<TeachFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      const res = await fetch(`/api/inspector/teach/candidates${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Feed request failed (${res.status})`);
      setFeed((await res.json()) as TeachFeed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the candidate feed.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="max-w-3xl mx-auto" style={{ fontFamily: SANS }}>
      {/* Header + the boundary invariant, stated in the interface's voice */}
      <header className="mb-5">
        <h1 className="text-[1.4rem] font-semibold tracking-tight">Candidate hand-off</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Teach captures candidates. Reviewing, resolving, and committing them to governed
          memory happens in <span className="font-medium text-foreground">Build</span> — a separate step.
        </p>
      </header>

      {/* Ready-to-hand-off summary */}
      <div className="flex items-stretch gap-3 mb-5">
        <SummaryTile label="Ready to hand off" value={feed?.readyCount ?? 0} accent="text-emerald-600 dark:text-emerald-400" />
        <SummaryTile label="Awaiting resolution" value={feed?.conflictCount ?? 0} accent="text-amber-600 dark:text-amber-400" />
        <SummaryTile label="Total candidates" value={feed?.total ?? 0} accent="text-foreground" />
      </div>

      {loading && <p className="text-sm text-muted-foreground py-8 text-center">Loading candidates…</p>}
      {error && (
        <p className="text-sm text-destructive py-8 text-center">
          {error} <button onClick={() => void load()} className="underline ml-1">retry</button>
        </p>
      )}

      {!loading && !error && feed && feed.candidates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground text-sm">
          No candidates captured yet. Teach Marcus something and it will appear here as a candidate.
        </div>
      )}

      {!loading && !error && feed && feed.candidates.length > 0 && (
        <ul className="space-y-2.5">
          {feed.candidates.map((c) => <CandidateRow key={c.id} c={c} />)}
        </ul>
      )}

      {/* The INERT hand-off boundary — no state-mutating handler behind it. */}
      <div className="mt-6 flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground max-w-md">
          This is a read-only hand-off. Candidates become governed memory only after review in Build.
        </p>
        <span
          role="note"
          title="Build is a separate step — nothing is committed from here."
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground select-none cursor-default"
        >
          Open in Build <ArrowRight size={15} />
        </span>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-card px-4 py-3">
      <div className={`text-2xl font-semibold ${accent}`} style={{ fontFamily: MONO }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function CandidateRow({ c }: { c: TeachCandidate }) {
  const meta = STATE_META[c.state];
  const StateIcon = meta.Icon;
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{TYPE_LABEL[c.type]}</Badge>
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.cls}`}>
              <StateIcon size={13} /> {meta.label}
            </span>
          </div>
          <p className="text-sm text-foreground leading-snug">{c.statement}</p>

          {/* Honest verification chip — never fabricated. */}
          {c.verification_result && <VerificationChip v={c.verification_result} />}

          {/* Conflict: existing-vs-new. */}
          {c.conflict && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded px-2 py-1.5">
              <span className="font-medium">Conflicts with existing:</span> “{c.conflict.existingStatement}”
              {c.conflict.note && <span className="text-muted-foreground"> — {c.conflict.note}</span>}
            </div>
          )}

          {/* Resolution: the recorded choice. */}
          {c.resolution && (
            <div className="mt-1.5 text-xs text-violet-700 dark:text-violet-300">
              Resolved: <span className="font-medium">{c.resolution.choice}</span>
              {c.resolution.scopeNote && <span className="text-muted-foreground"> — {c.resolution.scopeNote}</span>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function VerificationChip({ v }: { v: VerificationResult }) {
  if (v.state === 'confirmed') {
    return (
      <div className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
        <ShieldCheck size={13} /> Confirmed against the data estate{typeof v.rowCount === 'number' ? ` — ${v.rowCount} row(s)` : ''}
      </div>
    );
  }
  if (v.state === 'unconfirmed') {
    return (
      <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <HelpCircle size={13} /> Couldn’t confirm — 0 rows (advisory)
      </div>
    );
  }
  return (
    <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
      <HelpCircle size={13} /> Not verifiable{v.reason ? ` — ${v.reason}` : ' — model not governed'}
    </div>
  );
}

export default TeachDigest;
