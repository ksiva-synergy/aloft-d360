'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Database, Ruler, Tag, ArrowRight, Info } from 'lucide-react';

// ── Response shape (mirrors /api/inspector/semantic/entities-catalog) ──────────
interface DefConsumer { dashboardId: string; name: string; modelGoverned: boolean }
interface DimEntry {
  id: string; nodeId: string; label: string; status: string; dimensionType: string;
  resolvesTo: { fullPath: string; column: string | null };
  classification: { synonyms: string[]; aiContext: string | null; description: string | null };
  usedByMetrics: { measureId: string; label: string }[];
  consumers: DefConsumer[];
}
interface MeasEntry {
  id: string; nodeId: string; label: string; status: string; metricType: string;
  aggregate: string; unit: string | null;
  resolvesTo: { fullPath: string; column: string | null; expression: string | null };
  classification: { synonyms: string[]; aiContext: string | null; description: string | null };
  consumers: DefConsumer[];
}
interface EntityEntry {
  id: string; nodeId: string; label: string; fullPath: string; status: string;
  description: string | null; dimensions: DimEntry[]; measures: MeasEntry[];
}
type CatalogResponse =
  | { status: 'no_governed_model' }
  | { status: 'ok'; model: { id: string; name: string }; entities: EntityEntry[]; total: number; hasMore: boolean; dimensionTypes: string[]; omissions: { field: string; reason: string }[]; note: string }
  | { error: string };

const GOLD = '#FDB515';

function StatusBadge({ status }: { status: string }) {
  const governed = status === 'governed';
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[9px] font-semibold tracking-wider uppercase rounded-full px-2 py-0.5"
      style={
        governed
          ? { color: '#2DD4A0', background: 'rgba(45,212,160,0.12)', border: '1px solid rgba(45,212,160,0.5)' }
          : { color: GOLD, background: 'rgba(253,181,21,0.1)', border: '1px dashed rgba(253,181,21,0.6)' }
      }
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={governed ? { background: '#2DD4A0' } : { border: `1.5px dashed ${GOLD}` }}
      />
      {governed ? 'Governed' : 'Candidate'}
    </span>
  );
}

function FieldPill({ full, col, expr }: { full: string; col: string | null; expr: string | null }) {
  return (
    <span className="font-mono text-[10px]" style={{ color: 'var(--estate-text-secondary)' }}>
      <span style={{ color: '#5B9DFF' }}>{full}</span>
      {col ? <span style={{ color: 'var(--estate-ink)' }}>.{col}</span> : null}
      {expr ? <span style={{ color: GOLD }}> · expression</span> : null}
    </span>
  );
}

const PAGE = 40;

export default function EntitiesPage() {
  const [meta, setMeta] = useState<{ status: string; model?: { id: string; name: string }; total?: number; hasMore?: boolean; note?: string; omissions?: { field: string; reason: string }[] } | null>(null);
  const [entities, setEntities] = useState<EntityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = React.useCallback(async (query: string, offset: number) => {
    const first = offset === 0;
    if (first) { setLoading(true); } else { setLoadingMore(true); }
    setErr(null);
    try {
      const res = await fetch(`/api/inspector/semantic/entities-catalog?q=${encodeURIComponent(query)}&offset=${offset}&limit=${PAGE}`);
      if (res.status === 401) { setErr('Sign in to view the entities catalog.'); return; }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as CatalogResponse;
      if ('error' in data) { setErr(data.error); return; }
      if (data.status === 'no_governed_model') { setMeta({ status: 'no_governed_model' }); setEntities([]); return; }
      setMeta({ status: 'ok', model: data.model, total: data.total, hasMore: data.hasMore, note: data.note, omissions: data.omissions });
      setEntities((prev) => (first ? data.entities : [...prev, ...data.entities]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load entities');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Debounced search (and initial load).
  useEffect(() => {
    const t = setTimeout(() => { void load(q, 0); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const ink = 'var(--estate-ink)';
  const muted = 'var(--estate-text-secondary)';
  const raised = 'var(--estate-raised)';
  const borderGold = 'var(--estate-border-gold)';

  return (
    <div className="p-6 overflow-y-auto h-full scrollbar-thin bg-[var(--background)]">
      <div className="max-w-[1180px] mx-auto">
        <div className="mb-5">
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: ink, fontFamily: "'Source Serif 4', serif" }}>
            Entities
          </h1>
          <p className="text-sm mt-1.5" style={{ color: muted, fontFamily: "'Inter Tight', sans-serif" }}>
            Governed semantic model — entities (physical tables), their dimensions &amp; measures, and what consumes them.
          </p>
        </div>

        {/* Search */}
        {(!err && (loading || (meta && meta.status === 'ok'))) && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search entities by name or catalog.schema.table…"
            className="w-full mb-4 rounded-lg px-3 py-2.5 text-[13px] font-mono outline-none border"
            style={{ background: raised, borderColor: borderGold, color: ink }}
          />
        )}

        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="animate-pulse h-[220px] border rounded p-5" style={{ backgroundColor: raised, borderColor: borderGold }} />
            ))}
          </div>
        )}

        {!loading && err && (
          <div className="border border-dashed rounded-lg p-6 text-sm" style={{ backgroundColor: raised, borderColor: borderGold, color: muted }}>
            {err}
          </div>
        )}

        {!loading && !err && meta && meta.status === 'no_governed_model' && (
          <div className="flex justify-center py-12">
            <div className="max-w-md w-full border border-dashed rounded-lg p-10 flex flex-col items-center text-center gap-4" style={{ backgroundColor: raised, borderColor: borderGold }}>
              <span className="w-11 h-11 relative block" style={{ opacity: 0.7 }}>
                <span className="absolute inset-0 border-2 rotate-45" style={{ borderColor: GOLD }} />
                <span className="absolute inset-3 border-2 rotate-45 opacity-60" style={{ borderColor: GOLD }} />
              </span>
              <h2 className="text-xl font-serif font-semibold" style={{ color: ink, fontFamily: "'Source Serif 4', serif" }}>No governed model yet</h2>
              <p className="text-xs leading-relaxed" style={{ color: muted }}>
                The entities catalog surfaces a <b style={{ color: ink }}>governed</b> semantic model. Promote a model to governed to see its entities here.
              </p>
              <Link href="/agent-lab/estate/catalog" className="font-mono text-xs hover:underline" style={{ color: GOLD }}>
                Go to Catalog &rarr;
              </Link>
            </div>
          </div>
        )}

        {!loading && !err && meta && meta.status === 'ok' && (
          <>
            <div className="flex items-center gap-2 mb-4 text-[11px] font-mono" style={{ color: muted }}>
              <Info size={13} style={{ color: GOLD }} />
              <span>Model <b style={{ color: ink }}>{meta.model?.name}</b> · showing {entities.length} of {meta.total} entities · {meta.note}</span>
            </div>

            {/* First-class omissions — fields with no backing in the real model, named explicitly */}
            {meta.omissions && meta.omissions.length > 0 && (
              <div className="border border-dashed rounded-lg px-3 py-2 mb-4 text-[10px] font-mono" style={{ borderColor: 'var(--estate-border, rgba(148,163,196,0.2))', color: muted }}>
                Not resolvable from stored metadata: {meta.omissions.map((o) => `${o.field} — ${o.reason}`).join(' · ')}
              </div>
            )}

            {entities.length === 0 && (
              <div className="text-[12px] py-8 text-center" style={{ color: muted }}>No entities match “{q}”.</div>
            )}

            <div className="flex flex-col gap-4">
              {entities.map((e) => (
                <div key={e.id} className="border rounded-xl p-5" style={{ backgroundColor: raised, borderColor: borderGold }}>
                  <div className="flex items-center gap-3 mb-3">
                    <Database size={18} style={{ color: GOLD }} />
                    <div className="min-w-0">
                      <div className="text-lg" style={{ color: ink, fontFamily: "'Source Serif 4', serif" }}>{e.label}</div>
                      <div className="font-mono text-[10px]" style={{ color: '#5B9DFF' }}>{e.fullPath}</div>
                    </div>
                    <div className="ml-auto"><StatusBadge status={e.status} /></div>
                  </div>

                  {/* Dimensions */}
                  {e.dimensions.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 text-[9px] font-mono tracking-widest uppercase mb-2" style={{ color: muted }}>
                        <Tag size={11} /> Dimensions
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {e.dimensions.map((d) => (
                          <div key={d.id} className="border rounded-lg p-3" style={{ borderColor: 'var(--estate-border, rgba(148,163,196,0.2))', background: 'rgba(0,0,0,0.02)' }}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-[13px]" style={{ color: ink }}>{d.label}</span>
                              <span className="font-mono text-[8.5px] uppercase tracking-wide" style={{ color: muted }}>{d.dimensionType}</span>
                              <span className="ml-auto"><StatusBadge status={d.status} /></span>
                            </div>
                            <FieldPill full={d.resolvesTo.fullPath} col={d.resolvesTo.column} expr={null} />
                            {d.classification.synonyms.length > 0 && (
                              <div className="mt-1.5 text-[10px]" style={{ color: muted }}>
                                syn: {d.classification.synonyms.join(', ')}
                              </div>
                            )}
                            {d.usedByMetrics.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]" style={{ color: muted }}>
                                <span>used by:</span>
                                {d.usedByMetrics.map((m) => (
                                  <span key={m.measureId} className="font-mono px-1.5 rounded" style={{ background: 'rgba(167,139,250,0.14)', color: '#A78BFA' }}>{m.label}</span>
                                ))}
                              </div>
                            )}
                            {d.consumers.length > 0 && (
                              <div className="mt-1 text-[10px]" style={{ color: muted }}>{d.consumers.length} dashboard{d.consumers.length > 1 ? 's' : ''}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Measures */}
                  {e.measures.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-[9px] font-mono tracking-widest uppercase mb-2" style={{ color: muted }}>
                        <Ruler size={11} /> Measures
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {e.measures.map((m) => (
                          <div key={m.id} className="border rounded-lg p-3" style={{ borderColor: 'var(--estate-border, rgba(148,163,196,0.2))', background: 'rgba(0,0,0,0.02)' }}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-[13px]" style={{ color: ink }}>{m.label}</span>
                              <span className="font-mono text-[8.5px] uppercase tracking-wide" style={{ color: muted }}>{m.metricType} · {m.aggregate}{m.unit ? ` · ${m.unit}` : ''}</span>
                              <span className="ml-auto"><StatusBadge status={m.status} /></span>
                            </div>
                            <FieldPill full={m.resolvesTo.fullPath} col={m.resolvesTo.column} expr={m.resolvesTo.expression} />
                            <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: muted }}>
                              <Link href={`/agent-lab/estate/lineage?focus=${m.nodeId}`} className="inline-flex items-center gap-1 hover:underline" style={{ color: GOLD }}>
                                lineage <ArrowRight size={11} />
                              </Link>
                              {m.consumers.length > 0 && <span>· {m.consumers.length} dashboard{m.consumers.length > 1 ? 's' : ''}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {e.dimensions.length === 0 && e.measures.length === 0 && (
                    <div className="text-[11px]" style={{ color: muted }}>No non-archived dimensions or measures.</div>
                  )}
                </div>
              ))}
            </div>

            {meta.hasMore && (
              <div className="flex justify-center mt-5">
                <button
                  type="button"
                  onClick={() => void load(q, entities.length)}
                  disabled={loadingMore}
                  className="font-mono text-[11px] font-semibold tracking-wider uppercase border rounded px-4 py-2 disabled:opacity-50"
                  style={{ borderColor: GOLD, color: GOLD, background: 'transparent' }}
                >
                  {loadingMore ? 'Loading…' : `Load more (${(meta.total ?? 0) - entities.length} left)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
