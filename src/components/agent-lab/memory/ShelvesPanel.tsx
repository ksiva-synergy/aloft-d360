'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RULE_TYPE_COLORS,
  MONO,
  BODY,
  SERIF,
  ruleTypeColor,
  TOPIC_ALL_KNOWLEDGE_ACCENT,
  topicColor,
  GOLD,
} from '@/lib/foer/foer-tokens';
import { ALL_KNOWLEDGE_KEY as _ALL_KNOWLEDGE_KEY } from '@/lib/foer/topics'; // kept for future sidebar integration

function humanizeRuleType(ruleType: string): string {
  const labels: Record<string, string> = {
    HARD_RULE: 'Hard Rule', HEURISTIC: 'Heuristic', SOURCE_PREF: 'Source Pref',
    FAILURE_MODE: 'Failure Mode', SCHEMA_MAP: 'Schema Map',
  };
  return labels[ruleType] ?? ruleType.replace(/_/g, ' ');
}

interface FoerBullet {
  id: string;
  agentClass: string;
  taskSignature: string | null;
  shortLabel: string | null;
  blurb: string | null;
  ruleText: string;
  ruleType: string;
  confidence: number;
  helpfulCount: number;
  harmfulCount: number;
  status: string;
  version: number;
  sourceSessionIds: string[];
  validFrom: string;
  validUntil: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TopicEntry {
  topicKey: string;
  topicName: string;
  rank: number;
}

const RULE_TYPE_RADIUS: Record<string, number> = {
  HARD_RULE:    10,
  FAILURE_MODE:  8,
  SCHEMA_MAP:    7,
  SOURCE_PREF:   6,
  HEURISTIC:     6,
};

function orbRadius(ruleType: string): number {
  return RULE_TYPE_RADIUS[ruleType] ?? 6;
}

interface TooltipState {
  bullet: FoerBullet;
  x: number;
  y: number;
}

export function ShelvesPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const ruleTypeParam   = searchParams.get('ruleType')   ?? '';
  const agentClassParam = searchParams.get('agentClass') ?? '';

  const [showForgotten, setShowForgotten] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // activeGroup: topicKey of the drilled-into group, null = top-level group grid
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeGroupName, setActiveGroupName] = useState<string>('');

  // Sessions list is no longer used for topicMap (replaced by signatures response with topic join)
  // kept for future use (session timeline, etc.)
  const { data: _sessionsRes } = useQuery({
    queryKey: ['foer-sessions-list'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ sessions: any[] }>;
    },
  });

  // Stats for topic list + coverage badge
  const { data: statsRes, isLoading: isStatsLoading } = useQuery({
    queryKey: ['foer-memory-stats'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<any>;
    },
  });

  // Signatures — for shortLabel fallback
  const { data: signaturesRes } = useQuery({
    queryKey: ['foer-memory-signatures'],
    queryFn: async () => {
      const res = await fetch('/api/agent-lab/memory/signatures');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ signatures: Array<{ taskSignature: string; shortLabel: string | null; topicKey: string; topicName: string; topicRank: number; memberCount: number }> }>;
    },
  });

  // Fetch ALL bullets in one request (pageSize=500, no status filter when showForgotten)
  const { data: browseRes, isLoading: isBrowseLoading } = useQuery({
    queryKey: ['foer-memory-browse-all', ruleTypeParam, agentClassParam],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('pageSize', '500');
      // no status filter — we filter client-side so toggling showForgotten is instant
      params.set('status', '');
      if (ruleTypeParam)   params.set('ruleType',   ruleTypeParam);
      if (agentClassParam) params.set('agentClass', agentClassParam);
      const res = await fetch(`/api/agent-lab/memory/browse?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ bullets: FoerBullet[]; total: number; page: number }>;
    },
  });

  // Reclassify mutation
  const reclassifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agent-lab/memory/cluster', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foer-memory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['foer-sessions-list'] });
      queryClient.invalidateQueries({ queryKey: ['foer-memory-signatures'] });
    },
  });

  // Build taskSignature → shortLabel map
  const signatureLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of signaturesRes?.signatures ?? []) {
      if (s.taskSignature && s.shortLabel) {
        map.set(s.taskSignature, s.shortLabel);
      }
    }
    return map;
  }, [signaturesRes]);

  // Build taskSignature → TopicEntry map directly from signatures response
  // (signatures API joins PlatformMemoryTopic, so this covers ALL bullets regardless
  //  of whether their synthesis session has trace nodes)
  const topicMap = useMemo(() => {
    const map = new Map<string, TopicEntry>();
    for (const s of signaturesRes?.signatures ?? []) {
      if (
        s.taskSignature &&
        s.topicKey &&
        s.topicKey !== 'unassigned' &&
        s.topicKey !== 'all_knowledge'
      ) {
        map.set(s.taskSignature, {
          topicKey:  s.topicKey,
          topicName: s.topicName,
          rank:      s.topicRank ?? 999,
        });
      }
    }
    return map;
  }, [signaturesRes]);

  const allBullets = browseRes?.bullets ?? [];

  // Group lanes — top-level topic groups
  interface GroupLane {
    topicKey:   string;
    topicName:  string;
    rank:       number;
    bullets:    FoerBullet[];
    shortLabel: string | null;
  }

  // SubLane — per-taskSignature within a group
  interface SubLane {
    sig:        string;          // taskSignature or 'no-sig'
    label:      string;          // shortLabel or sig hash
    bullets:    FoerBullet[];
  }

  const lanes = useMemo((): GroupLane[] => {
    let filtered = allBullets;
    if (!showForgotten) filtered = filtered.filter((b) => b.status !== 'EXPIRED');

    const grouped = new Map<string, FoerBullet[]>();
    const uncatBySig = new Map<string, FoerBullet[]>();

    for (const b of filtered) {
      const t = b.taskSignature ? topicMap.get(b.taskSignature) : null;
      if (t) {
        if (!grouped.has(t.topicKey)) grouped.set(t.topicKey, []);
        grouped.get(t.topicKey)!.push(b);
      } else {
        const sigKey = b.taskSignature ?? 'no-sig';
        if (!uncatBySig.has(sigKey)) uncatBySig.set(sigKey, []);
        uncatBySig.get(sigKey)!.push(b);
      }
    }

    // Build ordered unique topic list from signaturesRes (already sorted by rank)
    const seenTopics = new Map<string, { topicName: string; rank: number }>();
    for (const s of signaturesRes?.signatures ?? []) {
      if (
        s.topicKey &&
        s.topicKey !== 'unassigned' &&
        s.topicKey !== 'all_knowledge' &&
        !seenTopics.has(s.topicKey)
      ) {
        seenTopics.set(s.topicKey, { topicName: s.topicName, rank: s.topicRank ?? 999 });
      }
    }

    const result: GroupLane[] = [...seenTopics.entries()]
      .map(([topicKey, { topicName, rank }]) => {
        const laneBullets = grouped.get(topicKey) ?? [];
        return {
          topicKey,
          topicName,
          rank,
          bullets:    [...laneBullets].sort((a, b) => orbRadius(b.ruleType) - orbRadius(a.ruleType)),
          shortLabel: null,
        };
      })
      .filter((lane) => lane.bullets.length > 0)
      .sort((a, b) => a.rank - b.rank);

    if (uncatBySig.size > 0) {
      const allUncatBullets: FoerBullet[] = [];
      for (const bullets of uncatBySig.values()) allUncatBullets.push(...bullets);
      result.push({
        topicKey:   'uncategorized',
        topicName:  'Unclassified',
        rank:        999,
        bullets:    [...allUncatBullets].sort((a, b) => orbRadius(b.ruleType) - orbRadius(a.ruleType)),
        shortLabel: null,
      });
    }

    return result;
  }, [allBullets, showForgotten, topicMap, signaturesRes]);

  // Sub-lanes for the drilled group: per-taskSignature breakdown
  const subLanes = useMemo((): SubLane[] => {
    if (!activeGroup) return [];

    const parentLane = lanes.find((l) => l.topicKey === activeGroup);
    if (!parentLane) return [];

    const bySig = new Map<string, FoerBullet[]>();
    for (const b of parentLane.bullets) {
      const sigKey = b.taskSignature ?? 'no-sig';
      if (!bySig.has(sigKey)) bySig.set(sigKey, []);
      bySig.get(sigKey)!.push(b);
    }

    // Build display labels: strip agentClass prefix, fallback to blurb
    const sigLabels = new Map<string, string>();
    for (const [sig, bullets] of bySig.entries()) {
      const raw = signatureLabelMap.get(sig) ?? '';
      const stripped = raw.replace(/^[^·]+·\s*/, '').trim();
      if (stripped) {
        sigLabels.set(sig, stripped);
      } else {
        const first = bullets[0];
        const fallback = first.blurb ?? first.shortLabel ?? humanizeRuleType(first.ruleType);
        sigLabels.set(sig, fallback);
      }
    }

    // Merge sigs that share the same stripped label into a single SubLane
    const mergedMap = new Map<string, { sigs: string[]; bullets: FoerBullet[] }>();
    for (const [sig, bullets] of bySig.entries()) {
      const label = sigLabels.get(sig)!;
      const existing = mergedMap.get(label);
      if (existing) {
        existing.sigs.push(sig);
        existing.bullets.push(...bullets);
      } else {
        mergedMap.set(label, { sigs: [sig], bullets: [...bullets] });
      }
    }

    return Array.from(mergedMap.entries())
      .map(([label, { sigs, bullets }]) => ({
        sig:     sigs[0],
        label:   sigs.length > 1 ? `${label}  (${sigs.length} variants)` : label,
        bullets: bullets.sort((a, b) => orbRadius(b.ruleType) - orbRadius(a.ruleType)),
      }))
      .sort((a, b) => b.bullets.length - a.bullets.length);
  }, [activeGroup, lanes, signatureLabelMap]);

  const handleOrbClick = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('bulletId', id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleOrbEnter = useCallback((e: React.MouseEvent, bullet: FoerBullet) => {
    setTooltip({ bullet, x: e.clientX, y: e.clientY });
  }, []);

  const handleOrbMove = useCallback((e: React.MouseEvent, bullet: FoerBullet) => {
    setTooltip({ bullet, x: e.clientX, y: e.clientY });
  }, []);

  const handleOrbLeave = useCallback(() => setTooltip(null), []);

  const isLoading = isStatsLoading || isBrowseLoading;

  // ── Tooltip portal ────────────────────────────────────────────────────────
  const tooltipEl = tooltip ? (
    <div
      style={{
        position:       'fixed',
        left:           tooltip.x + 14,
        top:            tooltip.y + 14,
        zIndex:         9999,
        width:          300,
        background:     'rgba(10,18,30,0.97)',
        backdropFilter: 'blur(8px)',
        border:         '1px solid rgba(253,181,21,0.18)',
        borderRadius:   6,
        padding:        '12px 14px',
        boxShadow:      '0 6px 24px rgba(0,0,0,0.55)',
        pointerEvents:  'none',
        display:        'flex',
        flexDirection:  'column',
        gap:            8,
      }}
    >
      <p style={{ fontFamily: SERIF, fontSize: '11.5px', color: '#F0F4F8', lineHeight: 1.5, margin: 0, fontWeight: 500 }}>
        {tooltip.bullet.ruleText}
      </p>
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontFamily:    MONO,
            fontSize:      '9px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color:         ruleTypeColor(tooltip.bullet.ruleType),
            border:        `1px solid ${ruleTypeColor(tooltip.bullet.ruleType)}50`,
            padding:       '1px 5px',
            borderRadius:  3,
            background:    `${ruleTypeColor(tooltip.bullet.ruleType)}10`,
          }}
        >
          {tooltip.bullet.ruleType.replace(/_/g, ' ')}
        </span>
        <span style={{ fontFamily: MONO, fontSize: '9px', color: '#8BAFC8' }}>
          v{tooltip.bullet.version} · {(tooltip.bullet.confidence * 100).toFixed(0)}% conf
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: '9px', color: '#4A6080' }}>
        <span>
          {tooltip.bullet.helpfulCount > 0 && <span style={{ color: '#6ABF8A' }}>{tooltip.bullet.helpfulCount}↑ helpful</span>}
          {tooltip.bullet.helpfulCount > 0 && tooltip.bullet.harmfulCount > 0 && ' · '}
          {tooltip.bullet.harmfulCount > 0 && <span style={{ color: '#D9774B' }}>{tooltip.bullet.harmfulCount}↓ harmful</span>}
          {tooltip.bullet.helpfulCount === 0 && tooltip.bullet.harmfulCount === 0 && 'no feedback yet'}
        </span>
        <span>{tooltip.bullet.sourceSessionIds?.length ?? 0} sessions</span>
      </div>
    </div>
  ) : null;

  return (
    <>
      {typeof window !== 'undefined' && tooltipEl ? createPortal(tooltipEl, document.body) : null}

      <div
        id="foer-shelves-panel"
        style={{
          position:      'relative',
          background:    'var(--foer-surface)',
          border:        '1px solid var(--foer-border)',
          borderRadius:  6,
          padding:       '2rem 2.5rem',
          display:       'flex',
          flexDirection: 'column',
          gap:           '1.5rem',
        }}
      >
        <style>{`
          .foer-orb-wrapper {
            cursor: pointer;
            transition: transform 0.15s ease;
            border-radius: 50%;
            flex-shrink: 0;
          }
          .foer-orb-wrapper:hover {
            transform: scale(1.25);
            z-index: 10;
          }
          @keyframes orb-shimmer {
            0%, 100% { opacity: 0.85; }
            50%       { opacity: 1.0; }
          }
          .foer-orb-shimmer {
            animation: orb-shimmer 4.5s ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .foer-orb-shimmer { animation: none !important; }
          }
          .foer-shelf-card {
            display: flex;
            flex-direction: column;
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--foer-border-dim);
            border-radius: 6px;
            padding: 14px 16px 16px;
            transition: border-color 0.15s ease;
            min-height: 140px;
          }
          .foer-shelf-card:hover {
            border-color: rgba(253,181,21,0.35);
          }
        `}</style>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <h2 style={{ fontFamily: SERIF, fontSize: '1.25rem', fontWeight: 600, color: 'var(--foer-text-pri)', margin: 0 }}>
                The Shelves
              </h2>
              {/* Coverage badge */}
              {statsRes?.flagStatus && (
                <span
                  style={{
                    fontFamily:    MONO,
                    fontSize:      '0.6rem',
                    letterSpacing: '0.05em',
                    padding:       '2px 7px',
                    borderRadius:  3,
                    border:        `1px solid ${
                      statsRes.flagStatus.coveragePercent >= 90
                        ? 'rgba(106,191,138,0.4)'
                        : statsRes.flagStatus.coveragePercent >= 75
                        ? 'rgba(253,181,21,0.35)'
                        : 'rgba(217,119,75,0.4)'
                    }`,
                    color: statsRes.flagStatus.coveragePercent >= 90
                      ? '#6ABF8A'
                      : statsRes.flagStatus.coveragePercent >= 75
                      ? '#FDB515'
                      : '#D9774B',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                  title={`${statsRes.flagStatus.coveragePercent}% of signatures classified into topics`}
                >
                  {statsRes.flagStatus.coveragePercent}% classified
                </span>
              )}
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.2rem' }}>
              {Object.entries(RULE_TYPE_COLORS).map(([rt, color]) => (
                <div key={rt} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div
                    style={{
                      width:        12,
                      height:       12,
                      borderRadius: '50%',
                      background:   color,
                      flexShrink:   0,
                      opacity:      0.9,
                    }}
                  />
                  <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--foer-text-mut)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {rt.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '4px' }}>
            {/* Reclassify button */}
            <button
              onClick={() => reclassifyMutation.mutate()}
              disabled={reclassifyMutation.isPending}
              title="Run k-means topic classification sweep"
              style={{
                fontFamily:      MONO,
                fontSize:        '0.65rem',
                letterSpacing:   '0.05em',
                padding:         '4px 10px',
                borderRadius:    3,
                border:          '1px solid rgba(253,181,21,0.4)',
                background:      reclassifyMutation.isPending ? 'rgba(253,181,21,0.08)' : 'transparent',
                color:           reclassifyMutation.isPending ? 'rgba(253,181,21,0.5)' : '#FDB515',
                cursor:          reclassifyMutation.isPending ? 'not-allowed' : 'pointer',
                textTransform:   'uppercase',
                transition:      'background 0.15s ease, color 0.15s ease',
                whiteSpace:      'nowrap',
              }}
            >
              {reclassifyMutation.isPending ? 'Classifying…' : 'Reclassify'}
            </button>

            <label
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        '0.5rem',
                cursor:     'pointer',
                fontSize:   '0.75rem',
                color:      'var(--foer-text-sec)',
                fontFamily: MONO,
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              <input
                type="checkbox"
                checked={showForgotten}
                onChange={(e) => setShowForgotten(e.target.checked)}
                style={{ accentColor: 'var(--foer-gold)', cursor: 'pointer' }}
              />
              Show Forgotten
            </label>
          </div>
        </div>

        {/* Reclassify result / error banner */}
        {reclassifyMutation.isSuccess && reclassifyMutation.data && (
          <div style={{
            fontFamily:  MONO,
            fontSize:    '0.65rem',
            color:       '#6ABF8A',
            background:  'rgba(106,191,138,0.08)',
            border:      '1px solid rgba(106,191,138,0.2)',
            borderRadius: 3,
            padding:     '6px 12px',
          }}>
            {reclassifyMutation.data.coveragePercent}% classified — {reclassifyMutation.data.clustersCreated} topics created,{' '}
            {reclassifyMutation.data.signaturesAssigned}/{reclassifyMutation.data.signaturesTotal} signatures assigned
            {reclassifyMutation.data.pullForwardTriggered && ' · ✓ pull-forward triggered'}
            {reclassifyMutation.data.warning && ` · ⚠ ${reclassifyMutation.data.warning}`}
          </div>
        )}
        {reclassifyMutation.isError && (
          <div style={{
            fontFamily:  MONO,
            fontSize:    '0.65rem',
            color:       '#D9774B',
            background:  'rgba(217,119,75,0.08)',
            border:      '1px solid rgba(217,119,75,0.2)',
            borderRadius: 3,
            padding:     '6px 12px',
          }}>
            Reclassify failed: {String(reclassifyMutation.error)}
          </div>
        )}

        {/* Breadcrumb (shown when drilled into a group) */}
        {activeGroup && (
          <div style={{
            display:     'flex',
            alignItems:  'center',
            gap:         '0.5rem',
            padding:     '8px 12px',
            background:  'rgba(253,181,21,0.06)',
            border:      '1px solid rgba(253,181,21,0.18)',
            borderRadius: 4,
          }}>
            <button
              onClick={() => { setActiveGroup(null); setActiveGroupName(''); }}
              style={{
                display:        'flex',
                alignItems:     'center',
                gap:            '5px',
                background:     'none',
                border:         'none',
                padding:        0,
                color:          GOLD,
                cursor:         'pointer',
                fontFamily:     MONO,
                fontSize:       '0.7rem',
                fontWeight:     600,
                letterSpacing:  '0.03em',
              }}
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>←</span>
              All Groups
            </button>
            <span style={{ color: 'rgba(253,181,21,0.35)', fontFamily: MONO, fontSize: '0.7rem' }}>›</span>
            <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: 'var(--foer-text-pri)', fontWeight: 500 }}>
              {activeGroupName}
            </span>
          </div>
        )}

        {/* Body */}
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'var(--foer-text-sec)', fontFamily: MONO, fontSize: '0.8rem' }}>
            Loading shelves…
          </div>
        ) : !activeGroup ? (
          /* ── TOP-LEVEL GROUP GRID ── */
          lanes.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', border: '1px dashed var(--foer-border-dim)', borderRadius: 6, color: 'var(--foer-text-mut)', fontFamily: BODY, fontSize: '0.9rem' }}>
              No memories match the active filters.
            </div>
          ) : (
            <>
              {/* Hint when only "Unclassified" group exists */}
              {lanes.length === 1 && lanes[0].topicKey === 'uncategorized' && (
                <div style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          '0.75rem',
                  padding:      '8px 12px',
                  background:   'rgba(217,119,75,0.07)',
                  border:       '1px solid rgba(217,119,75,0.2)',
                  borderRadius: 4,
                  fontFamily:   MONO,
                  fontSize:     '0.65rem',
                  color:        '#D9774B',
                }}>
                  <span>All memories are unclassified — run</span>
                  <button
                    onClick={() => reclassifyMutation.mutate()}
                    disabled={reclassifyMutation.isPending}
                    style={{
                      background:    'none',
                      border:        '1px solid rgba(217,119,75,0.4)',
                      borderRadius:  3,
                      padding:       '1px 8px',
                      color:         '#D9774B',
                      cursor:        reclassifyMutation.isPending ? 'not-allowed' : 'pointer',
                      fontFamily:    MONO,
                      fontSize:      '0.65rem',
                      whiteSpace:    'nowrap',
                    }}
                  >
                    {reclassifyMutation.isPending ? 'Classifying…' : 'Reclassify now'}
                  </button>
                  <span>to assign groups</span>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
              {lanes.map((lane) => {
                const isUncategorized = lane.topicKey === 'uncategorized';
                const accentColor = isUncategorized ? TOPIC_ALL_KNOWLEDGE_ACCENT : topicColor(lane.rank);

                return (
                  <button
                    key={lane.topicKey}
                    className="foer-shelf-card"
                    onClick={() => { setActiveGroup(lane.topicKey); setActiveGroupName(lane.topicName); }}
                    style={{
                      textAlign:   'left',
                      cursor:      'pointer',
                      background:  'rgba(255,255,255,0.03)',
                      border:      '1px solid var(--foer-border-dim)',
                      borderRadius: 6,
                      padding:     '14px 16px 16px',
                      transition:  'border-color 0.15s ease',
                      minHeight:   140,
                      display:     'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {/* Group name */}
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px' }}>
                        <div style={{ width: 3, height: '1.1em', background: accentColor, borderRadius: 2, flexShrink: 0, alignSelf: 'center' }} />
                        <span style={{ fontFamily: BODY, fontSize: '0.78rem', fontWeight: 600, color: 'var(--foer-text-pri)', lineHeight: 1.3, wordBreak: 'break-word' }}>
                          {lane.topicName || 'Unassigned'}
                        </span>
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--foer-text-mut)', paddingLeft: '10px' }}>
                        {lane.bullets.length} {lane.bullets.length === 1 ? 'memory' : 'memories'}
                        {' · '}
                        {new Set(lane.bullets.map((b) => b.taskSignature ?? 'no-sig')).size} subgroups
                      </span>
                    </div>
                    {/* Orb preview (first 18 orbs) */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', alignItems: 'center', marginTop: 'auto', paddingTop: '6px' }}>
                      {lane.bullets.slice(0, 18).map((bullet, index) => {
                        const typeColor = ruleTypeColor(bullet.ruleType);
                        const r = orbRadius(bullet.ruleType);
                        const diameter = r * 2;
                        let opacity: number;
                        let boxShadow = 'none';
                        let border = 'none';
                        if (bullet.status === 'ACTIVE') {
                          opacity = 1.0;
                          boxShadow = `0 0 ${r * 0.7}px ${typeColor}60`;
                        } else if (bullet.status === 'SUPERSEDED') {
                          opacity = 0.4;
                          border = `1.5px solid ${typeColor}`;
                        } else {
                          opacity = 0.18;
                        }
                        return (
                          <div
                            key={bullet.id}
                            className="foer-orb-shimmer"
                            style={{ width: diameter, height: diameter, borderRadius: '50%', background: typeColor, opacity, boxShadow, border, flexShrink: 0, animationDelay: `${index * 90}ms` }}
                          />
                        );
                      })}
                      {lane.bullets.length > 18 && (
                        <span style={{ fontFamily: MONO, fontSize: '0.55rem', color: 'var(--foer-text-mut)' }}>+{lane.bullets.length - 18}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            </>
          )
        ) : (
          /* ── SUBGROUP GRID (drilled into a group) ── */
          subLanes.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', border: '1px dashed var(--foer-border-dim)', borderRadius: 6, color: 'var(--foer-text-mut)', fontFamily: BODY, fontSize: '0.9rem' }}>
              No subgroups found.{' '}
              <button
                onClick={() => { setActiveGroup(null); setActiveGroupName(''); }}
                style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontFamily: MONO, fontSize: '0.8rem', textDecoration: 'underline' }}
              >
                ← Back to groups
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
              {subLanes.map((sub) => {
                // Derive agent-class badge from the original raw shortLabel prefix
                const rawLabel = signatureLabelMap.get(sub.sig) ?? '';
                const agentClassBadge = rawLabel.split(' · ')[0]?.trim() || null;

                return (
                <div key={sub.sig} className="foer-shelf-card">
                  {/* Subgroup header */}
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px' }}>
                      <div style={{ width: 3, height: '1.1em', background: GOLD, borderRadius: 2, flexShrink: 0, alignSelf: 'center', opacity: 0.6 }} />
                      <span style={{ fontFamily: BODY, fontSize: '0.75rem', fontWeight: 600, color: 'var(--foer-text-pri)', lineHeight: 1.3, wordBreak: 'break-word' }}>
                        {sub.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '10px' }}>
                      <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--foer-text-mut)' }}>
                        {sub.bullets.length} {sub.bullets.length === 1 ? 'memory' : 'memories'}
                      </span>
                      {agentClassBadge && (
                        <span style={{
                          fontFamily:    MONO,
                          fontSize:      '0.55rem',
                          color:         'var(--foer-text-mut)',
                          border:        '1px solid var(--foer-border-dim)',
                          borderRadius:  2,
                          padding:       '0px 4px',
                          letterSpacing: '0.03em',
                          opacity:       0.7,
                        }}>
                          {agentClassBadge}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Orb field — clickable */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', alignItems: 'center', marginTop: 'auto', paddingTop: '6px' }}>
                    {sub.bullets.map((bullet, index) => {
                      const typeColor = ruleTypeColor(bullet.ruleType);
                      const r = orbRadius(bullet.ruleType);
                      const diameter = r * 2;
                      let opacity: number;
                      let boxShadow = 'none';
                      let border = 'none';
                      if (bullet.status === 'ACTIVE') {
                        opacity = 1.0;
                        boxShadow = `0 0 ${r * 0.7}px ${typeColor}60`;
                      } else if (bullet.status === 'SUPERSEDED') {
                        opacity = 0.4;
                        border = `1.5px solid ${typeColor}`;
                      } else {
                        opacity = 0.18;
                      }
                      return (
                        <div
                          key={bullet.id}
                          className="foer-orb-wrapper foer-orb-shimmer"
                          title={bullet.blurb ?? bullet.ruleText}
                          data-rule-type={bullet.ruleType}
                          onClick={() => handleOrbClick(bullet.id)}
                          onMouseEnter={(e) => handleOrbEnter(e, bullet)}
                          onMouseMove={(e)  => handleOrbMove(e, bullet)}
                          onMouseLeave={handleOrbLeave}
                          style={{ width: diameter, height: diameter, background: typeColor, opacity, boxShadow, border, animationDelay: `${index * 90}ms` }}
                        />
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          )
        )}

        {/* Summary footer */}
        {!isLoading && (
          <div
            style={{
              borderTop:   '1px solid var(--foer-border-dim)',
              paddingTop:  '0.75rem',
              fontFamily:  MONO,
              fontSize:    '0.65rem',
              color:       'var(--foer-text-mut)',
              display:     'flex',
              gap:         '1.5rem',
            }}
          >
            {activeGroup ? (
              <>
                <span>{subLanes.length} subgroups</span>
                <span>{subLanes.reduce((s, l) => s + l.bullets.length, 0)} memories in {activeGroupName}</span>
              </>
            ) : (
              <>
                <span>{lanes.length} groups</span>
                <span>{lanes.reduce((s, l) => s + l.bullets.length, 0)} total memories</span>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
