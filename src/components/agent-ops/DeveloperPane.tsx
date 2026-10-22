'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkbenchMessage } from '@/components/agent-lab/workbench/types';
import { buildLiveTimeline, toolCallsFromMessages } from '@/lib/agent-ops/build-timeline';
import type { TraceLoopGroup } from '@/lib/agent-ops/types';
import type { SessionAnalytics } from '@/lib/agent-ops/session-cockpit';
import { AgentTraceTimeline } from './AgentTraceTimeline';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

interface DeveloperPaneProps {
  sessionId: string | null;
  messages: WorkbenchMessage[];
  isStreaming: boolean;
  selectedModel?: string;
  dbConnected?: boolean;
  contextMode?: string;
  surface?: 'inspector' | 'workbench';
}

export function DeveloperPane({
  sessionId,
  messages,
  isStreaming,
  selectedModel,
  dbConnected,
  contextMode,
  surface = 'inspector',
}: DeveloperPaneProps) {
  const [dbLoops, setDbLoops] = useState<TraceLoopGroup[]>([]);
  const [analytics, setAnalytics] = useState<SessionAnalytics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const runningSinceRef = useRef<number | null>(null);
  const [stuckWarning, setStuckWarning] = useState(false);

  const liveLoops = useMemo(() => buildLiveTimeline(messages), [messages]);
  const liveSpans = useMemo(() => toolCallsFromMessages(messages), [messages]);

  useEffect(() => {
    if (!sessionId) {
      setDbLoops([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/agent-lab/runs/${sessionId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { loops?: TraceLoopGroup[]; cockpit?: { analytics: SessionAnalytics; loops?: TraceLoopGroup[] } }) => {
        if (cancelled) return;
        setDbLoops(data.loops ?? data.cockpit?.loops ?? []);
        setAnalytics(data.cockpit?.analytics ?? null);
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load persisted invocations.');
      });
    return () => { cancelled = true; };
  }, [sessionId, isStreaming, messages.length]);

  const loops = liveSpans.length > 0 ? liveLoops : dbLoops;

  useEffect(() => {
    const hasRunning = liveSpans.some((s) => s.status === 'running');
    if (hasRunning && isStreaming) {
      if (runningSinceRef.current == null) runningSinceRef.current = Date.now();
    } else {
      runningSinceRef.current = null;
      setStuckWarning(false);
    }
  }, [liveSpans, isStreaming]);

  useEffect(() => {
    if (runningSinceRef.current == null) return;
    const id = window.setInterval(() => {
      if (runningSinceRef.current && Date.now() - runningSinceRef.current > 60_000) {
        setStuckWarning(true);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [liveSpans.some((s) => s.status === 'running'), isStreaming]);

  const errorCount = liveSpans.filter((s) => s.status === 'error').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--wb-canvas)' }}>
      <div
        style={{
          ...mono,
          fontSize: 10,
          padding: '10px 12px',
          borderBottom: '1px solid color-mix(in srgb, var(--brand-a) 15%, transparent)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          color: 'var(--ink-3)',
        }}
      >
        <span>SURFACE {surface}</span>
        {selectedModel && <span>MODEL {selectedModel}</span>}
        {contextMode && <span>CTX {contextMode}</span>}
        <span>DB {dbConnected ? 'ON' : 'OFF'}</span>
        {errorCount > 0 && <span style={{ color: '#D9774B' }}>LIVE ERR {errorCount}</span>}
        {analytics && (
          <>
            <span>TOOLS {analytics.totalToolCalls}</span>
            <span>TOK {(analytics.totalInputTokens + analytics.totalOutputTokens).toLocaleString()}</span>
            <span>TOOL {analytics.avgToolDurationMs}ms avg</span>
          </>
        )}
        {isStreaming && <span style={{ color: '#f59e0b' }}>STREAMING</span>}
      </div>
      {stuckWarning && (
        <div
          style={{
            ...mono,
            fontSize: 11,
            padding: '8px 12px',
            background: 'rgba(217,119,75,0.12)',
            borderBottom: '1px solid rgba(217,119,75,0.35)',
            color: '#D9774B',
          }}
        >
          A tool has been running for over 60s — check Databricks auth or server logs.
        </div>
      )}
      {loadError && !liveSpans.length && (
        <div style={{ ...mono, fontSize: 11, color: 'var(--ink-3)', padding: 12 }}>{loadError}</div>
      )}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <AgentTraceTimeline loops={loops} />
      </div>
      {sessionId && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid color-mix(in srgb, var(--brand-a) 12%, transparent)' }}>
          <a
            href={`/agent-lab/runs/${sessionId}`}
            style={{ ...mono, fontSize: 10, color: 'var(--brand-a)', textDecoration: 'none' }}
          >
            Full session intelligence →
          </a>
        </div>
      )}
    </div>
  );
}
