'use client';

/**
 * What the Power BI model definition (TMDL) says beyond tables, columns and measures: settings,
 * row-level security filters, incremental refresh windows, relationship semantics, parameters,
 * hierarchies, field parameters, dynamic formats, synonyms — and any TMDL feature not parsed yet.
 */

import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Callout, Tag } from '@/components/estate/object-ui';
import type { ModelDefinitionResponse } from '@/app/api/agent-lab/powerbi/models/[id]/definition/route';

const CARD = 'rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)]';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5">
      <h4 className="mb-1 text-caption font-medium text-[var(--estate-ink)]" title={hint}>
        {title}
      </h4>
      <div className="text-caption text-[var(--estate-text-secondary)]">{children}</div>
    </div>
  );
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="break-words rounded bg-[var(--estate-raised)] px-1 py-0.5 font-mono text-size-eyebrow">{children}</code>
);

const CARDINALITY: Record<string, string> = {
  many_to_one: 'many → one',
  one_to_one: 'one ↔ one',
  many_to_many: 'many ↔ many',
  one_to_many: 'one → many',
};

export function ModelDefinitionCard({ modelId, className }: { modelId: string; className?: string }) {
  const [d, setD] = useState<ModelDefinitionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // callers key this component by model id, so state starts empty for each model
    let alive = true;
    fetch(`/api/agent-lab/powerbi/models/${modelId}/definition`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ModelDefinitionResponse;
      })
      .then((x) => alive && setD(x))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [modelId]);

  if (error) return <p className={cn('text-caption text-[var(--estate-text-muted)]', className)}>Could not load the model definition ({error}).</p>;
  if (!d) return null;

  const unhandled = Object.entries(d.unhandled);
  const s = d.settings;
  return (
    <section className={cn(CARD, className)} aria-label="Model definition">
      <header className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--estate-border)] px-4 py-2">
        <h3 className="text-ui font-medium text-[var(--estate-ink)]">Model definition</h3>
        <span className="text-caption text-[var(--estate-text-muted)]">from the TMDL: settings, security, refresh and semantics</span>
      </header>

      {!d.complete && (
        <div className="px-4 pt-2.5">
          <Callout tone="neutral" icon={<Info className="size-4" />} title="Parsed with an older parser">
            Run the pipeline with <strong>Parse</strong> ticked to capture the full definition (RLS filters, refresh policies, hidden objects,
            relationship cardinality, synonyms).
          </Callout>
        </div>
      )}

      <div className="divide-y divide-[var(--estate-border)]">
        {s && (
          <Section title="Settings">
            <div className="flex flex-wrap gap-1.5">
              {s.compatibilityLevel != null && <Tag>Compatibility {s.compatibilityLevel}</Tag>}
              {s.culture && <Tag>Culture {s.culture}</Tag>}
              {s.sourceQueryCulture && (
                <Tag
                  tone={s.sourceQueryCulture !== s.culture ? 'amber' : 'neutral'}
                  title="Culture Power Query uses to turn text into dates and numbers (e.g. en-IN reads 01/02 as 1 February)"
                >
                  Query culture {s.sourceQueryCulture}
                </Tag>
              )}
              {s.timeIntelligenceEnabled != null && <Tag>Auto date/time {s.timeIntelligenceEnabled ? 'on' : 'off'}</Tag>}
              {s.discourageImplicitMeasures && <Tag>Implicit measures off</Tag>}
              {s.dataAccessOptions.map((o) => (
                <Tag key={o}>{o}</Tag>
              ))}
            </div>
          </Section>
        )}

        {d.roles.length > 0 && (
          <Section title={`Row-level security · ${d.roles.length} role${d.roles.length === 1 ? '' : 's'}`} hint="Filters Power BI applies per signed-in user">
            <ul className="space-y-1">
              {d.roles.map((r) => (
                <li key={r.name}>
                  <span className="font-medium text-[var(--estate-ink)]">{r.name}</span>
                  {r.modelPermission && <span className="text-[var(--estate-text-muted)]"> · {r.modelPermission}</span>}
                  {r.members > 0 && <span className="text-[var(--estate-text-muted)]"> · {r.members} member(s) in the definition</span>}
                  {r.tablePermissions.map((p, i) => (
                    <div key={i} className="ml-3">
                      {p.table && <span className="text-[var(--estate-text-muted)]">{p.table}: </span>}
                      {p.filter ? <Code>{p.filter}</Code> : <span className="text-[var(--estate-text-dim)]">no filter</span>}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {d.incrementalRefresh.length > 0 && (
          <Section title="Incremental refresh" hint="Power BI keeps only this window; SQL over the full warehouse table would count more rows">
            <ul className="space-y-0.5">
              {d.incrementalRefresh.map((t) => (
                <li key={t.table}>
                  <span className="font-medium text-[var(--estate-ink)]">{t.table}</span>
                  {t.filterColumn && <> by <Code>{t.filterColumn}</Code></>} · {t.keeps}
                  {t.window && (
                    <span className="text-[var(--estate-text-muted)]">
                      {' '}
                      · dataset holds {t.window.start} → {t.window.end} (applied in recreated SQL)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {d.relationships.length > 0 && (
          <Section title="Relationships with special behaviour">
            <ul className="space-y-0.5">
              {d.relationships.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5">
                  <Code>{r.from}</Code>
                  <span>→</span>
                  <Code>{r.to}</Code>
                  <Tag tone={r.cardinality === 'many_to_one' ? 'neutral' : 'amber'}>{CARDINALITY[r.cardinality] ?? r.cardinality}</Tag>
                  {r.crossFiltering === 'bothDirections' && <Tag>both directions</Tag>}
                  {!r.active && <Tag>inactive (USERELATIONSHIP)</Tag>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {d.parameters.length > 0 && (
          <Section title="Power Query parameters">
            <div className="flex flex-wrap gap-1.5">
              {d.parameters.map((p) => (
                <span key={p.name}>
                  {p.name} = <Code>{p.value}</Code>
                </span>
              ))}
            </div>
          </Section>
        )}

        {(d.fieldParameters.length > 0 || d.dynamicFormatMeasures.length > 0 || d.quickMeasures.length > 0) && (
          <Section title="Report helpers" hint="Objects that drive visuals rather than hold reportable numbers">
            {d.fieldParameters.length > 0 && <div>Field parameters: {d.fieldParameters.join(', ')}</div>}
            {d.dynamicFormatMeasures.length > 0 && (
              <div>
                Dynamic format strings:{' '}
                {d.dynamicFormatMeasures.map((m) => (
                  <span key={m.measure} title={m.expression} className="mr-2">
                    {m.measure}
                  </span>
                ))}
              </div>
            )}
            {d.quickMeasures.length > 0 && <div>Quick measures: {d.quickMeasures.map((q) => `${q.measure} (${q.template})`).join(', ')}</div>}
          </Section>
        )}

        {d.hierarchies.length > 0 && (
          <Section title="Hierarchies">
            <ul className="space-y-0.5">
              {d.hierarchies.slice(0, 12).map((h) => (
                <li key={`${h.table}.${h.name}`}>
                  {h.table} · {h.name}: {h.levels.join(' › ')}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Visibility and documentation">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>
              Hidden: {d.hidden.tables} tables, {d.hidden.columns} columns, {d.hidden.measures} measures
            </span>
            <span>
              Descriptions: {d.described.tables} tables, {d.described.columns} columns, {d.described.measures} measures
            </span>
            {Object.keys(d.dataCategories).length > 0 && (
              <span>Data categories: {Object.entries(d.dataCategories).map(([k, n]) => `${k} (${n})`).join(', ')}</span>
            )}
          </div>
        </Section>

        {d.synonyms && d.synonyms.objects > 0 && (
          <Section title={`Q&A synonyms · ${d.synonyms.objects} objects${d.synonyms.authored ? `, ${d.synonyms.authored} written by the author` : ''}`}>
            <ul className="space-y-0.5">
              {d.synonyms.examples.map((e) => (
                <li key={e.object}>
                  <Code>{e.object}</Code> {e.terms.join(' · ')}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {unhandled.length > 0 && (
          <Section title="TMDL features not parsed yet" hint="Present in the definition; scalar properties are kept, but the feature is not interpreted">
            <div className="flex flex-wrap gap-1.5">
              {unhandled.map(([k, n]) => (
                <Tag key={k} tone="amber">
                  {k} × {n}
                </Tag>
              ))}
            </div>
          </Section>
        )}
      </div>
    </section>
  );
}
