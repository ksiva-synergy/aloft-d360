'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RULE_TYPE_COLORS, TOPIC_COLORS, MONO, SERIF, BODY, ruleTypeColor } from '@/lib/foer/foer-tokens';

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
  embedText?: string | null;
}

export function MemoryDrawer() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const bulletId = searchParams.get('bulletId') ?? '';
  const isOpen = !!bulletId;

  // 1. Find bullet in the React Query cache
  const cachedBullet = useMemo(() => {
    if (!bulletId) return null;

    // Search browse cache — matches the key used by ShelvesPanel
    const browseQueries = queryClient.getQueriesData<{ bullets: FoerBullet[] }>({
      queryKey: ['foer-memory-browse-all'],
    });
    for (const [, data] of browseQueries) {
      if (data?.bullets) {
        const found = data.bullets.find((b) => b.id === bulletId);
        if (found) return found;
      }
    }

    // Also search legacy browse cache key for any older cached pages
    const legacyBrowseQueries = queryClient.getQueriesData<{ bullets: FoerBullet[] }>({
      queryKey: ['foer-memory-browse'],
    });
    for (const [, data] of legacyBrowseQueries) {
      if (data?.bullets) {
        const found = data.bullets.find((b) => b.id === bulletId);
        if (found) return found;
      }
    }

    // Search session details cache
    const traceQueries = queryClient.getQueriesData<{ bullets: FoerBullet[] }>({
      queryKey: ['foer-session-detail'],
    });
    for (const [, data] of traceQueries) {
      if (data?.bullets) {
        const found = data.bullets.find((b) => b.id === bulletId);
        if (found) return found;
      }
    }

    return null;
  }, [bulletId, queryClient]);

  // 2. Fallback fetch if not present in the React Query cache
  const { data: fallbackBullet, isLoading: isFallbackLoading } = useQuery<FoerBullet | null>({
    queryKey: ['foer-single-bullet-fallback', bulletId],
    queryFn: async () => {
      if (!bulletId) return null;
      // Fetch the same large page ShelvesPanel uses so any visible bullet is found
      const res = await fetch(`/api/agent-lab/memory/browse?status=&pageSize=500`);
      if (!res.ok) return null;
      const data = await res.json();
      return (data.bullets as FoerBullet[])?.find((b) => b.id === bulletId) ?? null;
    },
    enabled: isOpen && !cachedBullet,
  });

  const bullet = cachedBullet || fallbackBullet;

  // 3. Close handlers
  const handleClose = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('bulletId');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, searchParams, pathname, router]);

  // 4. Show full audit text state
  const [showFullAudit, setShowFullAudit] = useState(false);
  useEffect(() => {
    setShowFullAudit(false); // Reset toggle when bullet changes
  }, [bulletId]);

  // Calculate score and recency
  const recency = useMemo(() => {
    if (!bullet) return 0.4;
    if (!bullet.lastUsedAt) return 0.4;
    const diffMs = Date.now() - new Date(bullet.lastUsedAt).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays <= 7) return 1.0;
    if (diffDays <= 30) return 0.7;
    return 0.4;
  }, [bullet]);

  const score = useMemo(() => {
    if (!bullet) return 0;
    return bullet.confidence * (bullet.helpfulCount - bullet.harmfulCount) * recency;
  }, [bullet, recency]);

  const helpfulPct = useMemo(() => {
    if (!bullet) return 50;
    const total = bullet.helpfulCount + bullet.harmfulCount;
    return total === 0 ? 50 : (bullet.helpfulCount / total) * 100;
  }, [bullet]);

  if (!isOpen) return null;

  const color = bullet ? ruleTypeColor(bullet.ruleType) : '#8a9bb5';
  const embedAuditText = bullet ? (bullet.embedText ?? bullet.ruleText ?? '') : '';
  const isTruncated = embedAuditText.length > 200;
  const auditDisplayText = showFullAudit
    ? embedAuditText
    : embedAuditText.slice(0, 200) + (isTruncated ? '...' : '');

  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return 'active';
    try {
      const d = new Date(isoStr);
      return d.toISOString().replace('T', ' ').slice(0, 16);
    } catch {
      return isoStr;
    }
  };

  const handleSessionJump = (sessionId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sessionId', sessionId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5,9,15,0.60)',
          zIndex: 40,
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 250ms ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      />

      {/* Drawer Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: 'var(--foer-surface)',
          borderLeft: '1px solid var(--foer-border)',
          zIndex: 50,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms ease',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--foer-border-dim) transparent',
        }}
      >
        {/* Close Button */}
        <button
          onClick={handleClose}
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            alignSelf: 'flex-end',
            background: 'transparent',
            border: 'none',
            color: 'var(--foer-text-mut)',
            fontFamily: MONO,
            fontSize: 16,
            padding: '14px 18px',
            cursor: 'pointer',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.color = 'var(--foer-text-pri)';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.color = 'var(--foer-text-mut)';
          }}
        >
          ✕
        </button>

        {isFallbackLoading && !bullet ? (
          <div style={{ padding: '24px', fontFamily: MONO, fontSize: 11, color: 'var(--foer-text-sec)' }}>
            Loading memory details...
          </div>
        ) : !bullet ? (
          <div style={{ padding: '24px', fontFamily: MONO, fontSize: 11, color: 'var(--foer-text-sec)' }}>
            Memory not found.
          </div>
        ) : (
          <div style={{ padding: '0 24px 32px', marginTop: -12, display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* ── 1. HEADER ── */}
            <div>
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--foer-text-pri)',
                  marginBottom: 12,
                  lineHeight: 1.45,
                }}
              >
                {bullet.ruleText}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: '0.04em',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${color}`,
                    color: color,
                    background: `${color}10`,
                    textTransform: 'uppercase',
                  }}
                >
                  {bullet.ruleType.replace('_', ' ')}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: '0.04em',
                    padding: '2px 6px',
                    borderRadius: 4,
                    color:
                      bullet.status === 'ACTIVE'
                        ? TOPIC_COLORS[3]
                        : bullet.status === 'SUPERSEDED'
                        ? TOPIC_COLORS[5]
                        : 'var(--foer-text-mut)',
                    background: 'var(--foer-border-dim)',
                    textTransform: 'uppercase',
                  }}
                >
                  {bullet.status}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: 'var(--foer-text-sec)',
                  }}
                >
                  conf {bullet.confidence.toFixed(2)}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 9,
                    background: 'var(--foer-border-dim)',
                    borderRadius: 3,
                    padding: '1px 5px',
                    color: 'var(--foer-text-mut)',
                  }}
                >
                  v{bullet.version}
                </span>
              </div>
            </div>

            {/* ── 2. COUNTERS ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--foer-text-mut)',
                }}
              >
                Feedback &amp; Performance
              </div>
              
              {/* Horizontal Bar */}
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--foer-border-dim)',
                  overflow: 'hidden',
                  display: 'flex',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    width: `${helpfulPct}%`,
                    height: '100%',
                    background: 'var(--foer-gold)',
                  }}
                  title={`Helpful: ${bullet.helpfulCount}`}
                />
                <div
                  style={{
                    width: `${100 - helpfulPct}%`,
                    height: '100%',
                    background: RULE_TYPE_COLORS.FAILURE_MODE,
                  }}
                  title={`Harmful: ${bullet.harmfulCount}`}
                />
              </div>

              {/* Counts Legend */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10, color: 'var(--foer-text-sec)' }}>
                <span>{bullet.helpfulCount} helpful</span>
                <span>{bullet.harmfulCount} harmful</span>
              </div>

              {/* Score Formula */}
              <div
                style={{
                  background: 'var(--foer-surface2)',
                  border: '1px solid var(--foer-border-dim)',
                  borderRadius: 4,
                  padding: 10,
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: 'var(--foer-text-sec)',
                    marginBottom: 4,
                  }}
                >
                  Live Score Formula
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: 'var(--foer-gold)',
                    wordBreak: 'break-all',
                  }}
                >
                  score = {bullet.confidence.toFixed(2)} × ({bullet.helpfulCount} − {bullet.harmfulCount}) × {recency.toFixed(1)} = {score.toFixed(2)}
                </div>
              </div>
            </div>

            {/* ── 3. PROVENANCE ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--foer-text-mut)',
                }}
              >
                Provenance
              </div>
              <div style={{ fontFamily: BODY, fontSize: 12, color: 'var(--foer-text-sec)' }}>
                Born from {bullet.sourceSessionIds?.length ?? 0} sessions:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {bullet.sourceSessionIds?.map((sid) => (
                  <button
                    key={sid}
                    onClick={() => handleSessionJump(sid)}
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      background: 'var(--foer-surface2)',
                      border: '1px solid var(--foer-border-dim)',
                      borderRadius: 4,
                      padding: '2px 8px',
                      color: 'var(--foer-text-sec)',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s, color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget;
                      el.style.borderColor = 'var(--foer-gold)';
                      el.style.color = 'var(--foer-text-pri)';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.style.borderColor = 'var(--foer-border-dim)';
                      el.style.color = 'var(--foer-text-sec)';
                    }}
                  >
                    {sid.slice(0, 8)}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 4. BI-TEMPORAL ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--foer-text-mut)',
                }}
              >
                Bi-temporal Invariants
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: MONO, fontSize: 10, color: 'var(--foer-text-sec)' }}>
                <div>
                  <span style={{ color: 'var(--foer-text-mut)' }}>validFrom:</span> {formatDate(bullet.validFrom)}
                </div>
                <div>
                  <span style={{ color: 'var(--foer-text-mut)' }}>validUntil:</span> {bullet.validUntil ? formatDate(bullet.validUntil) : 'active'}
                </div>
              </div>
              {bullet.version > 1 && (
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: 'var(--foer-gold)',
                    background: 'var(--foer-surface2)',
                    border: '1px solid var(--foer-border-dim)',
                    borderRadius: 4,
                    padding: '6px 10px',
                    marginTop: 4,
                  }}
                >
                  v{bullet.version - 1} SUPERSEDED → v{bullet.version} ACTIVE
                </div>
              )}
            </div>

            {/* ── 5. AUDIT ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--foer-text-mut)',
                }}
              >
                Embedding Audit Trail
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: 'var(--foer-text-sec)',
                  background: 'var(--foer-surface2)',
                  border: '1px solid var(--foer-border-dim)',
                  borderRadius: 4,
                  padding: 10,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.5,
                }}
              >
                {auditDisplayText}
              </div>
              {isTruncated && (
                <button
                  onClick={() => setShowFullAudit(!showFullAudit)}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'transparent',
                    border: 'none',
                    fontFamily: MONO,
                    fontSize: 10,
                    color: 'var(--foer-gold)',
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  {showFullAudit ? 'Show less' : 'Show full'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
