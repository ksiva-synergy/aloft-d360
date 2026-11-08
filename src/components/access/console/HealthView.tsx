'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { accessFetch, runAsync } from './api';
import s from './console.module.css';

type Health = {
  days: number;
  modes: { access: string; columns: string };
  checked: number;
  people: number;
  outcomes: { ok: number; masked: number; totalsOnly: number; refused: number; unresolved: number };
  parserUnsureRate: number;
  checkMs: { p50: number | null; p95: number | null };
  queryMs: { p50: number | null; p95: number | null; count: number };
  topMasked: { column: string; count: number }[];
  topRefused: { column: string; count: number }[];
  gates: { overheadP95Under20ms: boolean; parserUnsureUnder2Pct: boolean };
};

const ms = (x: number | null) => (x === null ? '—' : x < 10 ? `${x.toFixed(2)} ms` : `${Math.round(x)} ms`);

function Gate({ okay, label }: { okay: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-caption">
      {okay ? <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 text-[var(--warn)]" aria-hidden="true" />}
      {label}
    </li>
  );
}

/** Column check health (E11-T3): what it did or would do, and what it costs. */
export function HealthView() {
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (d: number) => setH(await accessFetch<Health>(`/api/access/health?days=${d}`)), []);
  useEffect(() => {
    runAsync(() => load(days).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')));
  }, [days, load]);

  if (error) return <p className={s.errorText}>{error}</p>;
  if (!h) return <p className="text-caption text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-caption text-muted-foreground">
          Column check: <strong className="text-foreground">{h.modes.columns}</strong> · table check: <strong className="text-foreground">{h.modes.access}</strong>
        </span>
        <div className={cn(s.seg, 'ml-auto')} role="radiogroup" aria-label="Period">
          {([7, 14, 30] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} className={cn(s.segBtn, days === d && s.segBtnActive)} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      {h.modes.columns === 'off' ? (
        <p className="rounded-[8px] bg-[var(--surface-2)] px-3 py-2 text-caption text-muted-foreground">
          The column check is off, so nothing is recorded. Set COLUMN_ACCESS_MODE=shadow to measure it without changing anyone's results.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Queries checked', String(h.checked), `${h.people} people`],
          ['Would mask', String(h.outcomes.masked), 'ran with ••• columns'],
          ['Would refuse', String(h.outcomes.refused + h.outcomes.unresolved), `${h.outcomes.unresolved} not readable`],
          ['Check time p95', ms(h.checkMs.p95), `p50 ${ms(h.checkMs.p50)} · queries p50 ${ms(h.queryMs.p50)}`],
        ].map(([label, value, sub]) => (
          <div key={label} className={cn(s.card, 'px-4 py-3')}>
            <p className="text-caption text-muted-foreground">{label}</p>
            <p className="text-title-section">{value}</p>
            <p className="text-caption text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>
      <section className={s.card}>
        <div className={s.cardHead}>
          <h3 className={s.cardTitle}>Before switching to enforce</h3>
        </div>
        <ul className={cn(s.cardBody, 'flex flex-col gap-1')}>
          <Gate okay={h.gates.overheadP95Under20ms} label="Check adds under 20 ms at p95" />
          <Gate okay={h.gates.parserUnsureUnder2Pct} label="Under 2% of checked queries unreadable" />
          <Gate okay={h.outcomes.refused === 0} label={`No legitimate work refused (review the ${h.outcomes.refused} refusals below)`} />
        </ul>
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(
          [
            ['Most masked columns', h.topMasked],
            ['Most refused columns', h.topRefused],
          ] as const
        ).map(([title, list]) => (
          <section key={title} className={s.card}>
            <div className={s.cardHead}>
              <h3 className={s.cardTitle}>{title}</h3>
            </div>
            <ul className={cn(s.cardBody, 'flex flex-col gap-1 text-caption')}>
              {list.length === 0 ? <li className="text-muted-foreground">None.</li> : null}
              {list.map((x) => (
                <li key={x.column} className="flex gap-2">
                  <code className="min-w-0 flex-1 truncate" title={x.column}>
                    {x.column}
                  </code>
                  <span>{x.count}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
