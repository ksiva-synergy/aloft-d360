'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from '@/lib/navigation/link';
import type { InvocationRow, SessionAnalytics, SessionCockpitPayload } from '@/lib/agent-ops/session-cockpit';
import { AgentTraceTimeline } from './AgentTraceTimeline';
import { CallDrawer, type DrawerState } from './cockpit/CallDrawer';
import { InsightsPanel } from './cockpit/InsightsPanel';
import { InvocationList } from './cockpit/InvocationList';
import { LoopBreakdown } from './cockpit/LoopBreakdown';
import { ToolTable, ToolTimeBreakdown } from './cockpit/ToolBreakdown';
import { TurnStory } from './cockpit/TurnStory';
import { Waterfall } from './cockpit/Waterfall';
import { deriveInsights } from './cockpit/insights';
import { BORDER, CARD_BG, ERR, OK, TOOL_PALETTE, WARN, fmtMs, fmtTokens, fmtUsd, mono, pct, plural, sans } from './cockpit/format';
import { Chip, KpiCard, Panel, SectionTitle, SplitBar } from './cockpit/ui';

type Tab = 'overview' | 'tools' | 'turns' | 'timeline' | 'transcript';

function MessageBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: 12,
          borderTopRightRadius: isUser ? 4 : 12,
          borderTopLeftRadius: isUser ? 12 : 4,
          background: isUser ? 'color-mix(in srgb, var(--brand-a) 12%, transparent)' : CARD_BG,
          border: isUser ? '1px solid color-mix(in srgb, var(--brand-a) 25%, transparent)' : BORDER,
        }}
      >
        <div style={{ ...mono, fontSize: 'var(--type-caption-size)', color: isUser ? 'var(--brand-a)' : 'var(--ink-3)', marginBottom: 4 }}>{role}</div>
        <div style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', lineHeight: 1.6, color: 'var(--wb-ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text || '—'}</div>
      </div>
    </div>
  );
}

export interface SessionCockpitProps {
  sessionId: string;
  title: string;
  surface: string | null;
  contextMode: string | null;
  cockpit: SessionCockpitPayload;
  openHref: string;
}

export function SessionCockpit({ title, surface, contextMode, cockpit, openHref }: SessionCockpitProps) {
  const [tab, setTab] = useState<Tab>(cockpit.analytics.totalToolCalls > 0 ? 'overview' : cockpit.turns.length > 0 ? 'turns' : 'overview');
  const [selectedTurn, setSelectedTurn] = useState<number | null>(cockpit.turns[0]?.turnIndex ?? null);
  const [timelineTurn, setTimelineTurn] = useState<number | null>(null);
  const [toolFilter, setToolFilter] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const a: SessionAnalytics = cockpit.analytics;
  const selectedTurnData = cockpit.turns.find((t) => t.turnIndex === selectedTurn);
  const insights = useMemo(() => deriveInsights(cockpit), [cockpit]);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    [...cockpit.toolAnalytics].sort((x, y) => y.calls - x.calls).forEach((r, i) => map.set(r.toolName, TOOL_PALETTE[i % TOOL_PALETTE.length]));
    return (tool: string) => {
      if (!map.has(tool)) map.set(tool, TOOL_PALETTE[map.size % TOOL_PALETTE.length]);
      return map.get(tool)!;
    };
  }, [cockpit.toolAnalytics]);

  const timelineCalls = useMemo(
    () => (timelineTurn != null ? cockpit.chronology.filter((c) => c.turnIndex === timelineTurn) : cockpit.chronology),
    [cockpit.chronology, timelineTurn],
  );

  const openCalls = useCallback((items: InvocationRow[], index = 0, drawerTitle?: string) => {
    if (items.length > 0) setDrawer({ items, index, title: drawerTitle });
  }, []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const setDrawerIndex = useCallback((i: number) => setDrawer((d) => (d ? { ...d, index: i } : d)), []);

  const openTurn = (turnIndex: number) => {
    setSelectedTurn(turnIndex);
    setTab('turns');
  };

  const totalTokens = a.totalInputTokens + a.totalOutputTokens;
  const healthy = a.toolErrors === 0;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'turns', label: 'Turns', count: cockpit.turns.length },
    { id: 'timeline', label: 'Timeline', count: cockpit.chronology.length },
    { id: 'tools', label: 'Tools', count: cockpit.toolAnalytics.length },
    { id: 'transcript', label: 'Transcript' },
  ];

  const content: React.CSSProperties = { padding: 24, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1480, margin: '0 auto', width: '100%' };

  return (
    <div style={{ flex: 1, height: '100%', minHeight: 0, overflowY: 'auto', background: 'var(--wb-canvas)' }}>
      {/* ---------------- Header ---------------- */}
      <header style={{ padding: '18px 24px 0', maxWidth: 1480, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: '1 1 400px' }}>
            <Link href="/agent-lab/history" style={{ ...sans, fontSize: 'var(--type-caption-size)', color: 'var(--brand-a)', textDecoration: 'none' }}>
              ← Back to history
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <span
                title={healthy ? 'No tool errors' : `${a.toolErrors} tool errors`}
                style={{
                  ...sans,
                  fontSize: 'var(--type-caption-size)',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 999,
                  color: healthy ? OK : ERR,
                  background: `color-mix(in srgb, ${healthy ? OK : ERR} 12%, transparent)`,
                  whiteSpace: 'nowrap',
                }}
              >
                ● {healthy ? 'Healthy' : `${plural(a.toolErrors, 'error')}`}
              </span>
              <h1 style={{ ...sans, fontSize: 'var(--type-kpi-lg-size)', fontWeight: 600, lineHeight: 1.3, margin: 0, color: 'var(--wb-ink)' }}>{title || 'Session intelligence'}</h1>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <Chip title="Surface">{surface ?? 'session'}</Chip>
              <Chip title="Context mode">{contextMode ?? '—'}</Chip>
              <Chip title="Where tool rows came from">source: {a.invocationSource}</Chip>
              {a.modelsUsed.map((m) => (
                <Chip key={m} color="var(--brand-a)" title="Model">
                  {m}
                </Chip>
              ))}
            </div>
          </div>
          <Link
            href={openHref}
            style={{
              ...sans,
              fontSize: 'var(--type-ui-regular-size)',
              fontWeight: 500,
              padding: '9px 16px',
              borderRadius: 8,
              background: 'var(--brand-a)',
              color: 'var(--on-brand)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Open chat →
          </Link>
        </div>

        {a.totalToolCalls === 0 && a.turnCount > 0 && (
          <div
            style={{
              ...sans,
              fontSize: 'var(--type-ui-regular-size)',
              marginTop: 14,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--brand-a) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--brand-a) 25%, transparent)',
              color: 'var(--wb-ink-dim)',
            }}
          >
            No tool rows in the audit log for this session yet. Open the <strong>Turns</strong> tab for conversation structure.
            {a.invocationSource === 'none' && <> Run a <strong>new</strong> chat turn after the latest deploy so tools are logged; older sessions may only show Bandit trajectory for Inspector.</>}
            {a.invocationSource === 'bandit' && <> Showing tools recovered from <strong>Bandit trajectory</strong> (last scored turn).</>}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginTop: 18 }}>
          <KpiCard label="Turns" value={String(a.turnCount)} sub={a.turnCount > 0 ? `${(a.totalToolCalls / a.turnCount).toFixed(1)} calls per turn` : undefined} accent="var(--ink-3)" />
          <KpiCard
            label="Estimated cost"
            value={fmtUsd(a.estimatedCostUsd)}
            sub={a.turnCount > 0 ? `${fmtUsd(a.estimatedCostUsd / a.turnCount)} per turn` : undefined}
            accent="var(--brand-a)"
          />
          <KpiCard
            label="Tokens"
            value={fmtTokens(totalTokens)}
            sub={
              <>
                <span style={{ color: 'var(--brand-b)' }}>■</span> in {fmtTokens(a.totalInputTokens)} · <span style={{ color: 'var(--brand-a)' }}>■</span> out{' '}
                {fmtTokens(a.totalOutputTokens)}
              </>
            }
            footer={
              <SplitBar
                parts={[
                  { value: a.totalInputTokens, color: 'var(--brand-b)', label: 'Input' },
                  { value: a.totalOutputTokens, color: 'var(--brand-a)', label: 'Output' },
                ]}
              />
            }
            accent="var(--brand-b)"
          />
          <KpiCard
            label="Tool calls"
            value={String(a.totalToolCalls)}
            sub={<span style={{ color: a.toolErrors > 0 ? ERR : OK }}>{(a.toolSuccessRate * 100).toFixed(0)}% success · {a.toolErrors} err</span>}
            footer={
              a.totalToolCalls > 0 ? (
                <SplitBar
                  parts={[
                    { value: a.totalToolCalls - a.toolErrors, color: OK, label: 'Succeeded' },
                    { value: a.toolErrors, color: ERR, label: 'Failed' },
                  ]}
                />
              ) : undefined
            }
            accent={a.toolErrors > 0 ? ERR : OK}
          />
          <KpiCard label="Time in tools" value={fmtMs(a.totalToolDurationMs)} sub={`avg ${fmtMs(a.avgToolDurationMs)} · p95 ${fmtMs(a.p95ToolDurationMs)}`} accent={WARN} />
          {a.server && (
            <KpiCard
              label="Model vs tools"
              value={fmtMs(a.server.llmMs)}
              sub={
                <>
                  model · tools {fmtMs(a.server.toolWallMs)}
                  {a.server.avgFirstTokenMs != null && <> · 1st token {fmtMs(a.server.avgFirstTokenMs)}</>}
                  {a.server.turnsCovered < a.turnCount && <> · {a.server.turnsCovered}/{a.turnCount} turns recorded</>}
                </>
              }
              footer={
                <SplitBar
                  parts={[
                    { value: a.server.llmMs, color: 'var(--brand-a)', label: 'Model' },
                    { value: a.server.toolWallMs, color: WARN, label: 'Tools' },
                  ]}
                />
              }
              accent="var(--brand-a)"
            />
          )}
          {a.server && a.server.inputTokens > 0 && (
            <KpiCard
              label="Prompt cache"
              value={pct(a.server.cacheReadTokens, a.server.inputTokens)}
              sub={`${fmtTokens(a.server.cacheReadTokens)} of ${fmtTokens(a.server.inputTokens)} input cached`}
              footer={
                <SplitBar
                  parts={[
                    { value: a.server.cacheReadTokens, color: '#14b8a6', label: 'Cached' },
                    { value: a.server.inputTokens - a.server.cacheReadTokens, color: 'var(--wb-border-subtle)', label: 'Full price' },
                  ]}
                />
              }
              accent="#14b8a6"
            />
          )}
          {a.totalTurnDurationMs > 0 && (
            <KpiCard
              label="Turn time"
              value={fmtMs(a.totalTurnDurationMs)}
              sub={`${a.outcomes.completed} done · ${a.outcomes.truncated} trunc · ${a.outcomes.errored} err`}
              accent="var(--ink-3)"
            />
          )}
        </div>
      </header>

      {/* ---------------- Sticky tabs ---------------- */}
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          marginTop: 18,
          background: 'color-mix(in srgb, var(--wb-canvas) 92%, transparent)',
          backdropFilter: 'blur(8px)',
          borderBottom: BORDER,
        }}
      >
        <div style={{ maxWidth: 1480, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', gap: 2, overflowX: 'auto', flex: 1 }}>
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  style={{
                    ...sans,
                    fontSize: 'var(--type-ui-regular-size)',
                    fontWeight: active ? 600 : 500,
                    padding: '12px 14px',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--brand-a)' : '2px solid transparent',
                    background: 'transparent',
                    color: active ? 'var(--wb-ink)' : 'var(--ink-3)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.label}
                  {t.count != null && (
                    <span
                      style={{
                        ...mono,
                        fontSize: 'var(--type-caption-size)',
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: active ? 'color-mix(in srgb, var(--brand-a) 15%, transparent)' : 'var(--wb-border-subtle)',
                        color: active ? 'var(--brand-a)' : 'var(--ink-3)',
                      }}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* stays visible while scrolling */}
          <div style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', whiteSpace: 'nowrap', display: 'flex', gap: 12 }}>
            <span>{fmtUsd(a.estimatedCostUsd)}</span>
            <span>{fmtTokens(totalTokens)} tok</span>
            <span style={{ color: healthy ? OK : ERR }}>
              {a.totalToolCalls - a.toolErrors}/{a.totalToolCalls} ok
            </span>
          </div>
        </div>
      </nav>

      {/* ---------------- Overview ---------------- */}
      {tab === 'overview' && (
        <div style={content}>
          {insights.length > 0 && (
            <div>
              <SectionTitle hint="Automatic observations about this run. Click one to inspect the calls behind it.">What stands out</SectionTitle>
              <InsightsPanel insights={insights} onOpen={(calls, t) => openCalls(calls, 0, t)} />
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
            <Panel style={{ flex: '3 1 560px' }}>
              <SectionTitle hint="Each question, the steps the agent took, and its answer. Click a step to inspect those calls.">How the agent worked</SectionTitle>
              <TurnStory
                turns={cockpit.turns}
                colorOf={colorOf}
                onOpenCalls={(calls, t) => openCalls(calls, 0, t)}
                onOpenTurn={openTurn}
                onReadAnswer={() => setTab('transcript')}
              />
            </Panel>
            <div style={{ flex: '2 1 380px', display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
              <Panel>
                <SectionTitle hint="Share of total tool time. Click a tool to see all its calls.">Where the time went</SectionTitle>
                <ToolTimeBreakdown
                  rows={cockpit.toolAnalytics}
                  colorOf={colorOf}
                  onSelect={(name) => {
                    setToolFilter(name);
                    setTab('tools');
                  }}
                />
              </Panel>
              {cockpit.bandit.length > 0 && (
                <Panel>
                  <SectionTitle hint="Composite score with correctness / tools / speed / grounding parts.">Quality score</SectionTitle>
                  {cockpit.bandit.map((b) => (
                    <div key={b.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: BORDER }}>
                      <span style={{ ...mono, fontSize: 'var(--type-title-section-size)', color: 'var(--wb-ink)', minWidth: 56 }}>{b.compositeScore?.toFixed(2) ?? '—'}</span>
                      <Chip>{b.modelId ?? 'model n/a'}</Chip>
                      <Chip color={b.outcome === 'completed' ? OK : undefined}>{b.outcome ?? '—'}</Chip>
                      {(['C', 'T', 'S', 'G'] as const).map((k) => {
                        const v = b[`score${k}` as const];
                        return (
                          <span key={k} style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)' }}>
                            {k} <span style={{ color: 'var(--wb-ink-dim)' }}>{v != null ? v.toFixed(2) : '—'}</span>
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </Panel>
              )}
            </div>
          </div>

          {cockpit.chronology.length > 0 && (
            <Panel>
              <SectionTitle hint="Every tool call as a bar. Hover for the duration, click to inspect.">Execution timeline</SectionTitle>
              <Waterfall calls={cockpit.chronology} colorOf={colorOf} onOpen={(i) => openCalls(cockpit.chronology, i, 'All calls')} />
            </Panel>
          )}
        </div>
      )}

      {/* ---------------- Turns ---------------- */}
      {tab === 'turns' && (
        <div style={{ ...content, flexDirection: 'row', alignItems: 'flex-start' }}>
          <aside style={{ width: 300, flexShrink: 0, position: 'sticky', top: 64, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
            {cockpit.turns.map((t) => {
              const selected = selectedTurn === t.turnIndex;
              return (
                <button
                  key={t.turnIndex}
                  type="button"
                  onClick={() => setSelectedTurn(t.turnIndex)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    marginBottom: 6,
                    borderRadius: 10,
                    border: selected ? '1px solid color-mix(in srgb, var(--brand-a) 45%, transparent)' : '1px solid transparent',
                    background: selected ? 'color-mix(in srgb, var(--brand-a) 8%, transparent)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--brand-a)' }}>Turn {t.turnIndex}</span>
                    <span style={{ ...mono, fontSize: 'var(--type-caption-size)', color: t.errorCount ? ERR : 'var(--ink-3)' }}>
                      {t.errorCount ? `${t.errorCount} err` : plural(t.toolCallCount, 'tool')}
                    </span>
                  </div>
                  <div
                    style={{
                      ...sans,
                      fontSize: 'var(--type-ui-regular-size)',
                      color: 'var(--wb-ink)',
                      marginTop: 4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {t.userExcerpt || '(no prompt)'}
                  </div>
                </button>
              );
            })}
          </aside>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {selectedTurnData ? (
              <>
                <Panel>
                  <SectionTitle>Turn {selectedTurnData.turnIndex}</SectionTitle>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <MessageBubble role="user" text={selectedTurnData.userExcerpt} />
                    {selectedTurnData.assistantExcerpt && <MessageBubble role="assistant" text={selectedTurnData.assistantExcerpt} />}
                  </div>
                  {selectedTurnData.turnOps && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                      <Chip color="var(--brand-a)">{selectedTurnData.turnOps.modelName}</Chip>
                      <Chip>{plural(selectedTurnData.turnOps.loopCount, 'loop')}</Chip>
                      <Chip>
                        {fmtTokens(selectedTurnData.turnOps.inputTokens)} in · {fmtTokens(selectedTurnData.turnOps.outputTokens)} out
                      </Chip>
                      <Chip>{fmtMs(selectedTurnData.turnOps.durationMs)}</Chip>
                      {selectedTurnData.turnOps.firstTokenMs != null && <Chip>TTFT {fmtMs(selectedTurnData.turnOps.firstTokenMs)}</Chip>}
                      <Chip color={selectedTurnData.turnOps.outcome === 'completed' ? OK : ERR}>{selectedTurnData.turnOps.outcome}</Chip>
                    </div>
                  )}
                </Panel>
                {selectedTurnData.server && (
                  <Panel>
                    <SectionTitle hint="Each LLM call in this turn: time thinking vs waiting on tools, how big the context was, and how much came from the prompt cache.">
                      Loop by loop
                    </SectionTitle>
                    <LoopBreakdown server={selectedTurnData.server} />
                  </Panel>
                )}
                {selectedTurnData.invocations.length > 0 && (
                  <Panel>
                    <SectionTitle hint="Calls in the order they ran.">Timeline for this turn</SectionTitle>
                    <Waterfall
                      calls={selectedTurnData.invocations}
                      colorOf={colorOf}
                      onOpen={(i) => openCalls(selectedTurnData.invocations, i, `Turn ${selectedTurnData.turnIndex}`)}
                    />
                  </Panel>
                )}
                <Panel>
                  <SectionTitle hint="Click a row to inspect the SQL, input and output.">Tool calls ({selectedTurnData.invocations.length})</SectionTitle>
                  <InvocationList
                    items={selectedTurnData.invocations}
                    colorOf={colorOf}
                    onOpen={(items, i) => openCalls(items, i, `Turn ${selectedTurnData.turnIndex}`)}
                  />
                </Panel>
              </>
            ) : (
              <p style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: 'var(--ink-3)' }}>Select a turn on the left.</p>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Timeline ---------------- */}
      {tab === 'timeline' && (
        <div style={content}>
          <Panel>
            <SectionTitle
              hint={timelineTurn != null ? `Showing turn ${timelineTurn} only.` : 'Every call across the run.'}
              right={
                <select
                  value={timelineTurn ?? ''}
                  onChange={(e) => setTimelineTurn(e.target.value === '' ? null : Number(e.target.value))}
                  style={{ ...sans, fontSize: 'var(--type-caption-size)', padding: '5px 8px', borderRadius: 6, border: BORDER, background: 'var(--wb-canvas)', color: 'var(--wb-ink)' }}
                >
                  <option value="">All turns</option>
                  {cockpit.turns.map((t) => (
                    <option key={t.turnIndex} value={t.turnIndex}>
                      Turn {t.turnIndex}
                    </option>
                  ))}
                </select>
              }
            >
              Execution timeline
            </SectionTitle>
            <Waterfall calls={timelineCalls} colorOf={colorOf} onOpen={(i) => openCalls(timelineCalls, i, 'Timeline')} />
          </Panel>
          <Panel>
            <SectionTitle hint="Click a row to inspect.">Call log</SectionTitle>
            <InvocationList items={timelineCalls} colorOf={colorOf} onOpen={(items, i) => openCalls(items, i, 'Call log')} groupByTurn />
          </Panel>
          <Panel>
            <SectionTitle hint="Tool spans grouped by agent loop.">Agent loops</SectionTitle>
            <AgentTraceTimeline loops={cockpit.loops} emptyLabel="No persisted tool rows in database. Check Turns tab for message-embedded tool cards (older sessions)." />
          </Panel>
        </div>
      )}

      {/* ---------------- Tools ---------------- */}
      {tab === 'tools' && (
        <div style={content}>
          <Panel>
            <SectionTitle hint="Click a row to filter the call history below.">Tool analytics</SectionTitle>
            <ToolTable rows={cockpit.toolAnalytics} onSelect={(n) => setToolFilter((cur) => (cur === n ? null : n))} selected={toolFilter} />
          </Panel>
          <Panel>
            <SectionTitle
              hint={toolFilter ? `Showing only ${toolFilter}.` : 'Every call, grouped by turn.'}
              right={
                toolFilter ? (
                  <button
                    type="button"
                    onClick={() => setToolFilter(null)}
                    style={{ ...sans, fontSize: 'var(--type-caption-size)', padding: '4px 10px', borderRadius: 6, border: BORDER, background: 'transparent', color: 'var(--wb-ink-dim)', cursor: 'pointer' }}
                  >
                    Clear filter ✕
                  </button>
                ) : undefined
              }
            >
              Call history
            </SectionTitle>
            <InvocationList
              items={cockpit.chronology}
              highlightTool={toolFilter}
              colorOf={colorOf}
              onOpen={(items, i) => openCalls(items, i, toolFilter ?? 'Call history')}
              groupByTurn
            />
          </Panel>
        </div>
      )}

      {/* ---------------- Transcript ---------------- */}
      {tab === 'transcript' && (
        <div style={{ ...content, maxWidth: 900 }}>
          {cockpit.turns.map((t) => (
            <div key={t.turnIndex} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--brand-a)' }}>Turn {t.turnIndex}</span>
                <span style={{ flex: 1, height: 1, background: 'var(--wb-border-subtle)' }} />
                {t.toolCallCount > 0 && (
                  <button type="button" onClick={() => openTurn(t.turnIndex)} style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    {plural(t.toolCallCount, 'tool call')} →
                  </button>
                )}
              </div>
              <MessageBubble role="user" text={t.userExcerpt} />
              <MessageBubble role="assistant" text={t.assistantExcerpt} />
            </div>
          ))}
        </div>
      )}

      <CallDrawer state={drawer} onClose={closeDrawer} onIndex={setDrawerIndex} colorOf={colorOf} />
    </div>
  );
}
