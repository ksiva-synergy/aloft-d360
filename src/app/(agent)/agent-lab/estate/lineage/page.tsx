'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Database, Ruler, Tag, LayoutDashboard, AlertTriangle, Info } from 'lucide-react';

// ── Response shape (mirrors /api/inspector/semantic/lineage) ───────────────────
interface ResolvesTo { fullPath: string; column: string | null; expression: string | null; resultAlias: string }
interface EstateNode { id: string; kind: 'estate'; entityId: string; label: string; fullPath: string; status: string }
interface DefNode {
  id: string; kind: 'dimension' | 'measure'; defId: string; entityId: string; label: string; status: string;
  resolvesTo: ResolvesTo;
  classification: { synonyms: string[]; aiContext: string | null; description: string | null; dimensionType?: string; metricType?: string; aggregate?: string; unit?: string | null };
  compiledSql?: string; capped?: boolean; cappedBy?: string[];
}
interface ConsumerNode { id: string; kind: 'consumer'; dashboardId: string; label: string; visibility: string; modelGoverned: boolean }
type LineageNode = EstateNode | DefNode | ConsumerNode;
interface LineageEdge { from: string; to: string; kind: 'membership' | 'join' | 'consumes'; candidate?: boolean; joinKeys?: string }
interface FocusOption { id: string; label: string; kind: 'measure' | 'estate'; status: string }
interface Omission { field: string; reason: string }
interface FocusGraph { focusId: string; truncated: boolean; nodes: LineageNode[]; edges: LineageEdge[]; omissions: Omission[] }
type LineageResponse =
  | { status: 'no_governed_model' }
  | { status: 'ok'; model: { id: string; name: string }; focusOptions: { options: FocusOption[]; total: number; hasMore: boolean }; focus: FocusGraph | null; omissions: Omission[]; governance?: { total: number; governed: number; candidate: number; pctCandidate: number; note?: string } }
  | { error: string };

const GOLD = '#FDB515';

function StatusDot({ status }: { status: string }) {
  const gov = status === 'governed';
  return <span className="w-2 h-2 rounded-full inline-block" style={gov ? { background: '#2DD4A0' } : { border: `1.5px dashed ${GOLD}` }} />;
}
function nodeIcon(n: { kind: string }) {
  if (n.kind === 'estate') return <Database size={14} style={{ color: '#5B9DFF' }} />;
  if (n.kind === 'consumer') return <LayoutDashboard size={14} style={{ color: '#A78BFA' }} />;
  return n.kind === 'measure' ? <Ruler size={14} style={{ color: GOLD }} /> : <Tag size={14} style={{ color: '#2DD4A0' }} />;
}

export default function LineagePage() {
  const [model, setModel] = useState<{ id: string; name: string } | null>(null);
  const [options, setOptions] = useState<{ options: FocusOption[]; total: number; hasMore: boolean } | null>(null);
  const [focus, setFocus] = useState<FocusGraph | null>(null);
  const [noModel, setNoModel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [governance, setGovernance] = useState<{ total: number; governed: number; candidate: number; pctCandidate: number; note?: string } | null>(null);

  const ink = 'var(--estate-ink)';
  const muted = 'var(--estate-text-secondary)';
  const raised = 'var(--estate-raised)';
  const borderGold = 'var(--estate-border-gold)';
  const softBorder = 'var(--estate-border, rgba(148,163,196,0.2))';

  const fetchGraph = React.useCallback(async (focusId: string | null, query: string) => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (focusId) params.set('focus', focusId);
      if (query) params.set('q', query);
      const res = await fetch(`/api/inspector/semantic/lineage?${params.toString()}`);
      if (res.status === 401) { setErr('Sign in to view lineage.'); return; }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as LineageResponse;
      if ('error' in data) { setErr(data.error); return; }
      if (data.status === 'no_governed_model') { setNoModel(true); return; }
      setNoModel(false);
      setModel(data.model);
      setOptions(data.focusOptions);
      setFocus(data.focus);
      setSelected(data.focus?.focusId ?? null);
      setGovernance(data.governance ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load lineage');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — honor ?focus from the entities-page deep link.
  useEffect(() => {
    const urlFocus = new URLSearchParams(window.location.search).get('focus');
    void fetchGraph(urlFocus, '');
  }, [fetchGraph]);

  // Debounced option search — refresh the picker list only (keep current focus graph).
  useEffect(() => {
    if (loading && !model) return; // skip during first load
    const t = setTimeout(async () => {
      if (!model) return;
      const params = new URLSearchParams();
      if (focus?.focusId) params.set('focus', focus.focusId);
      if (q) params.set('q', q);
      const res = await fetch(`/api/inspector/semantic/lineage?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as LineageResponse;
      if ('status' in data && data.status === 'ok') setOptions(data.focusOptions);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const nodeById = useMemo(() => new Map((focus?.nodes ?? []).map((n) => [n.id, n])), [focus]);
  const cols = useMemo(() => ({
    estate: (focus?.nodes ?? []).filter((n) => n.kind === 'estate') as EstateNode[],
    defs: (focus?.nodes ?? []).filter((n) => n.kind === 'dimension' || n.kind === 'measure') as DefNode[],
    consumers: (focus?.nodes ?? []).filter((n) => n.kind === 'consumer') as ConsumerNode[],
  }), [focus]);

  const focusNode = focus ? nodeById.get(focus.focusId) : null;
  const detailNode = (selected && nodeById.get(selected)) || focusNode || null;

  return (
    <div className="p-6 overflow-y-auto h-full scrollbar-thin bg-[var(--background)]">
      <div className="max-w-[1180px] mx-auto">
        <div className="mb-5">
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: ink, fontFamily: "'Source Serif 4', serif" }}>Lineage</h1>
          <p className="text-sm mt-1.5" style={{ color: muted, fontFamily: "'Inter Tight', sans-serif" }}>
            One graph, two lenses — estate table → definition → consumers. Pick a metric (forward) or an entity (reverse).
          </p>
        </div>

        {err && (
          <div className="border border-dashed rounded-lg p-6 text-sm" style={{ backgroundColor: raised, borderColor: borderGold, color: muted }}>{err}</div>
        )}

        {!err && noModel && (
          <div className="flex justify-center py-12">
            <div className="max-w-md w-full border border-dashed rounded-lg p-10 flex flex-col items-center text-center gap-4" style={{ backgroundColor: raised, borderColor: borderGold }}>
              <h2 className="text-xl font-serif font-semibold" style={{ color: ink }}>No governed model yet</h2>
              <p className="text-xs" style={{ color: muted }}>Lineage traces a governed semantic model. Promote one to see its graph.</p>
              <Link href="/agent-lab/estate/catalog" className="font-mono text-xs hover:underline" style={{ color: GOLD }}>Go to Catalog &rarr;</Link>
            </div>
          </div>
        )}

        {!err && !noModel && (
          <>
            {/* Focus picker (searchable — the model has thousands of nodes) */}
            <div className="border rounded-xl p-3 mb-4" style={{ backgroundColor: raised, borderColor: borderGold }}>
              <div className="text-[9px] font-mono tracking-widest uppercase mb-2" style={{ color: muted }}>
                Focus · metric (forward) or entity (reverse){model ? ` · ${options?.total ?? 0} focusable nodes` : ''}
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search metrics &amp; entities…"
                className="w-full mb-2 rounded-lg px-3 py-2 text-[12px] font-mono outline-none border"
                style={{ background: 'rgba(0,0,0,0.02)', borderColor: softBorder, color: ink }}
              />
              <div className="flex flex-wrap gap-2 max-h-[132px] overflow-y-auto scrollbar-thin">
                {(options?.options ?? []).map((f) => {
                  const on = f.id === focus?.focusId;
                  return (
                    <button
                      key={f.id}
                      onClick={() => { void fetchGraph(f.id, ''); }}
                      className="inline-flex items-center gap-2 font-mono text-[10px] rounded-lg px-2.5 py-1.5 border transition-colors"
                      style={on ? { borderColor: GOLD, background: 'rgba(253,181,21,0.1)', color: ink } : { borderColor: softBorder, background: 'transparent', color: muted }}
                    >
                      {nodeIcon(f)}
                      <span className="max-w-[220px] truncate">{f.label}</span>
                      <span className="text-[8px] uppercase tracking-wide" style={{ color: muted }}>{f.kind === 'measure' ? 'metric' : 'entity'}</span>
                    </button>
                  );
                })}
                {options && options.hasMore && <span className="text-[10px] self-center" style={{ color: muted }}>+{options.total - options.options.length} more — refine search</span>}
              </div>
            </div>

            {/* Estate-wide bootstrap context — attaches the WHY to a heavily-capped view */}
            {governance?.note && (
              <div className="border border-dashed rounded-lg px-3.5 py-2.5 mb-4 text-[11px] leading-relaxed" style={{ borderColor: softBorder, color: muted, fontFamily: "'Inter Tight', sans-serif" }}>
                <b style={{ color: ink }}>{governance.candidate} of {governance.total}</b> definitions are candidate ({governance.pctCandidate}%). {governance.note}
              </div>
            )}

            {loading && !focus && <div className="animate-pulse h-[280px] border rounded-xl" style={{ backgroundColor: raised, borderColor: borderGold }} />}

            {focus && focusNode && (
              <>
                {/* Candidate cap banner (Pin #3 — explicit state, not a 500) */}
                {focusNode.kind === 'measure' && (focusNode as DefNode).capped && (
                  <div className="border rounded-lg p-3.5 mb-4 flex gap-3" style={{ background: 'rgba(253,181,21,0.1)', borderColor: GOLD }}>
                    <AlertTriangle size={16} style={{ color: GOLD, flex: 'none', marginTop: 1 }} />
                    <div className="text-[12px] leading-relaxed" style={{ color: muted, fontFamily: "'Inter Tight', sans-serif" }}>
                      <b style={{ color: ink }}>Governance ceiling.</b> <b style={{ color: ink }}>{focusNode.label}</b> touches a <b style={{ color: GOLD }}>candidate</b> definition
                      {(focusNode as DefNode).cappedBy?.length ? <> ({(focusNode as DefNode).cappedBy!.map((id) => nodeById.get(id)?.label ?? id.replace(/^\w+:/, '')).join(', ')})</> : null}.
                      This is a governance-lens ceiling computed over per-definition status — <i>not</i> an execution block (a governed model still executes candidate defs). Honest, never a crash.
                    </div>
                  </div>
                )}

                {focus.truncated && (
                  <div className="text-[10px] font-mono mb-3" style={{ color: GOLD }}>Neighborhood truncated — this entity has more definitions than shown.</div>
                )}

                {/* 3-column graph */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                  {(['estate', 'defs', 'consumers'] as const).map((colKey) => {
                    const heads = { estate: 'Estate table', defs: 'Definition', consumers: 'Consumers' } as const;
                    const list: LineageNode[] = cols[colKey];
                    return (
                      <div key={colKey}>
                        <div className="text-[8.5px] font-mono tracking-widest uppercase text-center pb-2 mb-2 border-b" style={{ color: muted, borderColor: softBorder }}>{heads[colKey]}</div>
                        <div className="flex flex-col gap-2">
                          {list.length === 0 && <div className="text-[10px] text-center py-3" style={{ color: muted }}>—</div>}
                          {list.map((n) => {
                            const isFocus = n.id === focus.focusId;
                            const isSel = n.id === (selected ?? focus.focusId);
                            const def = (n.kind === 'dimension' || n.kind === 'measure') ? (n as DefNode) : null;
                            const cand = def?.status === 'candidate';
                            const capped = n.kind === 'measure' && (n as DefNode).capped;
                            return (
                              <button
                                key={n.id}
                                onClick={() => setSelected(n.id)}
                                className="text-left border rounded-lg p-2.5 transition-colors"
                                style={{
                                  background: 'rgba(0,0,0,0.02)',
                                  borderColor: isSel ? GOLD : cand || capped ? 'rgba(253,181,21,0.55)' : softBorder,
                                  borderStyle: cand || capped ? 'dashed' : 'solid',
                                  boxShadow: isFocus ? `0 0 0 1px ${GOLD}` : 'none',
                                }}
                              >
                                <div className="flex items-center gap-2">
                                  {nodeIcon(n)}
                                  <span className="text-[11.5px] truncate" style={{ color: ink }}>{n.label}</span>
                                  {def && <span className="ml-auto"><StatusDot status={def.status} /></span>}
                                </div>
                                {n.kind === 'estate' && <div className="font-mono text-[9px] mt-1 truncate" style={{ color: '#5B9DFF' }}>{(n as EstateNode).fullPath}</div>}
                                {def && <div className="font-mono text-[9px] mt-1" style={{ color: muted }}>{def.resolvesTo.column ?? 'expression'}{capped ? ' · capped' : ''}</div>}
                                {n.kind === 'consumer' && <div className="text-[9px] mt-1" style={{ color: muted }}>{(n as ConsumerNode).visibility}{(n as ConsumerNode).modelGoverned ? '' : ' · model not governed'}</div>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Join keys (Pin #2) */}
                {focus.edges.some((e) => e.kind === 'join') && (
                  <div className="text-[10px] font-mono mb-4" style={{ color: muted }}>
                    {focus.edges.filter((e) => e.kind === 'join').map((e, i) => (
                      <div key={i}>join: <span style={{ color: '#5B9DFF' }}>{nodeById.get(e.from)?.label ?? e.from}</span> ↔ <span style={{ color: '#5B9DFF' }}>{nodeById.get(e.to)?.label ?? e.to}</span> on <span style={{ color: ink }}>{e.joinKeys}</span></div>
                    ))}
                  </div>
                )}

                {/* Detail panel */}
                {detailNode && (
                  <div className="border rounded-xl p-5" style={{ backgroundColor: raised, borderColor: borderGold }}>
                    <div className="flex items-center gap-2 mb-3">
                      {nodeIcon(detailNode)}
                      <span className="text-lg" style={{ color: ink, fontFamily: "'Source Serif 4', serif" }}>{detailNode.label}</span>
                      <span className="font-mono text-[9px] uppercase tracking-wide ml-1" style={{ color: muted }}>{detailNode.kind}</span>
                    </div>

                    {detailNode.kind === 'estate' && (
                      <div className="font-mono text-[11px]" style={{ color: '#5B9DFF' }}>{(detailNode as EstateNode).fullPath}</div>
                    )}

                    {(detailNode.kind === 'dimension' || detailNode.kind === 'measure') && (() => {
                      const d = detailNode as DefNode;
                      return (
                        <div className="flex flex-col gap-2 text-[12px]" style={{ color: muted, fontFamily: "'Inter Tight', sans-serif" }}>
                          <div><span className="font-mono text-[9px] uppercase" style={{ color: muted }}>resolves to</span>{' '}
                            <span className="font-mono text-[11px]"><span style={{ color: '#5B9DFF' }}>{d.resolvesTo.fullPath}</span>{d.resolvesTo.column ? <span style={{ color: ink }}>.{d.resolvesTo.column}</span> : <span style={{ color: GOLD }}> · expression</span>}</span>
                          </div>
                          <div><span className="font-mono text-[9px] uppercase" style={{ color: muted }}>result key</span>{' '}
                            <span className="font-mono text-[11px]" style={{ color: ink }}>{d.resolvesTo.resultAlias}</span>
                            <span className="text-[10px]"> (rows come back keyed by this, not the label)</span>
                          </div>
                          {d.resolvesTo.expression && <div className="font-mono text-[10px] p-2 rounded" style={{ background: 'rgba(0,0,0,0.03)', color: ink }}>{d.resolvesTo.expression}</div>}
                          {d.classification.synonyms.length > 0 && <div>synonyms: {d.classification.synonyms.join(', ')}</div>}
                          {d.classification.description && <div>{d.classification.description}</div>}
                          {d.capped && (
                            <div className="text-[11px] p-2 rounded" style={{ background: 'rgba(253,181,21,0.1)', color: GOLD }}>
                              Capped by candidate: {d.cappedBy?.map((id) => nodeById.get(id)?.label ?? id.replace(/^\w+:/, '')).join(', ')}
                            </div>
                          )}
                          {d.compiledSql && (
                            <div className="mt-1">
                              <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wide mb-1" style={{ color: muted }}>
                                <Info size={11} /> Compiled SQL — read-only trust-spine peek
                              </div>
                              <pre className="font-mono text-[10.5px] leading-relaxed p-3 rounded overflow-x-auto" style={{ background: 'rgba(0,0,0,0.04)', color: ink }}>{d.compiledSql}</pre>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {detailNode.kind === 'consumer' && (
                      <div className="text-[12px]" style={{ color: muted }}>
                        Dashboard · {(detailNode as ConsumerNode).visibility}
                        {!(detailNode as ConsumerNode).modelGoverned && <span> · this dashboard&apos;s model is not governed</span>}
                      </div>
                    )}
                  </div>
                )}

                {focus.omissions.length > 0 && (
                  <div className="mt-4 text-[10px] font-mono" style={{ color: muted }}>Not shown (no backing in the real model): {focus.omissions.map((o) => `${o.field} — ${o.reason}`).join(' · ')}</div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
