'use client';

import React from 'react';
import type { TraceLoopGroup } from '@/lib/agent-ops/types';
import { ToolSpanRow } from './ToolSpanRow';
import { type } from '@/lib/typography/tokens';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

interface AgentTraceTimelineProps {
  loops: TraceLoopGroup[];
  emptyLabel?: string;
}

export function AgentTraceTimeline({ loops, emptyLabel = 'No tool spans yet.' }: AgentTraceTimelineProps) {
  if (loops.length === 0) {
    return (
      <div style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', padding: 16 }}>{emptyLabel}</div>
    );
  }

  return (
    <div style={{ padding: '8px 12px 16px' }}>
      {loops.map((group) => (
        <section key={group.loop} style={{ marginBottom: 16 }}>
          <div
            style={{
              ...type.label,
              color: 'var(--brand-a)',
              marginBottom: 6,
            }}
          >
            Loop {group.loop}
          </div>
          <div style={{ borderLeft: '1px solid color-mix(in srgb, var(--brand-a) 20%, transparent)', paddingLeft: 8 }}>
            {group.tools.map((span) => (
              <ToolSpanRow key={span.callId} span={span} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
