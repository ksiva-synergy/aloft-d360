'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Info, Lock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, runAsync } from './api';
import s from './console.module.css';

type Info = {
  where: { catalog: string; schema: string; table: string; path: string; kind: string };
  column: { name: string; position: number | null; type: string | null; nullable: boolean | null; comment: string | null; description: string | null; role: string | null; entity: string | null; personalData: boolean };
  profile: { emptyRate: number | null; distinct: number | null; min: unknown; max: unknown; topValues: { value: unknown; count: number }[]; patterns: unknown[] };
  tableInfo: { summary: string | null; grain: string | null; rows: number | null; keywords: string[] };
  harvested: { structure: string | null; profile: string | null; description: string | null };
  protections: { name: string; on: string; reason: string | null }[];
};

const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'not yet');

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1 text-caption">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** ⓘ next to a column: everything the estate knows about it (Data access admins; sample values shown). */
export function ColumnInfoButton({ table, column }: { table: string; column: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-[var(--surface-2)] hover:text-foreground"
        aria-label={`About ${column} in ${table}`}
        title="About this column"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open ? <ColumnInfoDialog table={table} column={column} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ColumnInfoDialog({ table, column, onClose }: { table: string; column: string; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    runAsync(() =>
      accessFetch<Info>(`/api/access/column-info?table=${encodeURIComponent(table)}&column=${encodeURIComponent(column)}`).then(setInfo, (e) =>
        setError(e instanceof Error ? e.message : 'Could not load'),
      ),
    );
  }, [table, column]);

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className={cn(userStyles.surface, 'max-w-xl overflow-x-hidden')}>
        <div role="dialog" aria-modal="true" aria-label={`About ${column}`}>
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="break-all text-title-card">{column}</h2>
              <p className="break-all text-caption text-muted-foreground">{table}</p>
            </div>
            <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {error ? (
            <p className={s.errorText}>{error}</p>
          ) : !info ? (
            <p className="text-caption text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex flex-col gap-4">
              {info.protections.length ? (
                <p className="flex flex-wrap items-center gap-1.5 text-caption">
                  {info.protections.map((p) => (
                    <span key={`${p.name}:${p.on}`} className={cn(s.chip, s.chipBrand)} title={p.reason ?? undefined}>
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      {p.name}
                      {p.on !== 'column' ? ` (on ${p.on})` : ''}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="text-caption text-muted-foreground">Not protected.</p>
              )}

              <section aria-label="What it holds">
                <h3 className="mb-1 text-size-ui font-semibold">What it holds</h3>
                <dl>
                  <Row label="Description">{info.column.description ?? '—'}</Row>
                  <Row label="Role">{fmt(info.column.role)}</Row>
                  {info.column.entity ? <Row label="About">{info.column.entity}</Row> : null}
                  <Row label="Type">
                    {fmt(info.column.type)}
                    {info.column.nullable === false ? ' · always filled' : ''}
                  </Row>
                  {info.column.comment ? <Row label="Source comment">{info.column.comment}</Row> : null}
                  {info.column.personalData ? <Row label="Personal data">Flagged by the harvest as personal data</Row> : null}
                </dl>
              </section>

              <section aria-label="Values">
                <h3 className="mb-1 text-size-ui font-semibold">Values</h3>
                <dl>
                  <Row label="Most common">
                    {info.profile.topValues.length ? (
                      <span className="flex flex-wrap gap-1">
                        {info.profile.topValues.map((t, i) => (
                          <span key={i} className={s.chip}>
                            {fmt(t.value)}
                            <span className="text-muted-foreground">×{t.count}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Row>
                  <Row label="Range">
                    {fmt(info.profile.min)} → {fmt(info.profile.max)}
                  </Row>
                  <Row label="Distinct">{info.profile.distinct !== null ? `about ${info.profile.distinct.toLocaleString()}` : '—'}</Row>
                  <Row label="Empty">{info.profile.emptyRate !== null ? `${(info.profile.emptyRate * 100).toFixed(1)}%` : '—'}</Row>
                  {info.profile.patterns.length ? <Row label="Patterns">{info.profile.patterns.map(fmt).join(', ')}</Row> : null}
                </dl>
              </section>

              <section aria-label="Where">
                <h3 className="mb-1 text-size-ui font-semibold">Where</h3>
                <dl>
                  <Row label="Catalog">{info.where.catalog}</Row>
                  <Row label="Schema">{info.where.schema}</Row>
                  <Row label="Table">
                    {info.where.table} <span className="text-muted-foreground">({info.where.kind}{info.tableInfo.rows !== null ? ` · about ${info.tableInfo.rows.toLocaleString()} rows` : ''})</span>
                  </Row>
                  {info.tableInfo.summary ? <Row label="Table is about">{info.tableInfo.summary}</Row> : null}
                  {info.tableInfo.grain ? <Row label="One row is">{info.tableInfo.grain}</Row> : null}
                  {info.tableInfo.keywords.length ? <Row label="Keywords">{info.tableInfo.keywords.slice(0, 12).join(', ')}</Row> : null}
                  <Row label="Harvested">
                    structure {day(info.harvested.structure)} · profile {day(info.harvested.profile)} · description {day(info.harvested.description)}
                  </Row>
                </dl>
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
