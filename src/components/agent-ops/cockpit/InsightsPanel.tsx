'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Coins, Layers, Repeat, Timer, type LucideIcon } from 'lucide-react';
import type { InvocationRow } from '@/lib/agent-ops/session-cockpit';
import { BORDER, CARD_BG, ERR, OK, WARN, sans } from './format';
import type { Insight, InsightIcon, InsightKind } from './insights';

const KIND_COLOR: Record<InsightKind, string> = { good: OK, warn: WARN, bad: ERR, info: 'var(--brand-b)' };
const ICONS: Record<InsightIcon, LucideIcon> = {
  check: CheckCircle2,
  alert: AlertTriangle,
  repeat: Repeat,
  coins: Coins,
  timer: Timer,
  layers: Layers,
};

export function InsightsPanel({ insights, onOpen }: { insights: Insight[]; onOpen: (calls: InvocationRow[], title: string) => void }) {
  if (insights.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 }}>
      {insights.map((ins) => {
        const color = KIND_COLOR[ins.kind];
        const Icon = ICONS[ins.icon];
        const clickable = Boolean(ins.calls && ins.calls.length > 0);
        return (
          <button
            key={ins.id}
            type="button"
            disabled={!clickable}
            onClick={() => ins.calls && onOpen(ins.calls, ins.title)}
            style={{
              display: 'flex',
              gap: 12,
              textAlign: 'left',
              padding: 14,
              borderRadius: 12,
              border: BORDER,
              background: CARD_BG,
              cursor: clickable ? 'pointer' : 'default',
              transition: 'border-color 120ms, transform 120ms',
            }}
            onMouseEnter={(e) => clickable && (e.currentTarget.style.borderColor = `color-mix(in srgb, ${color} 50%, transparent)`)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
          >
            <span
              style={{
                flexShrink: 0,
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color,
                background: `color-mix(in srgb, ${color} 14%, transparent)`,
              }}
            >
              <Icon size={16} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ ...sans, display: 'block', fontSize: 'var(--type-ui-regular-size)', fontWeight: 600, color: 'var(--wb-ink)', lineHeight: 1.35 }}>{ins.title}</span>
              <span style={{ ...sans, display: 'block', fontSize: 'var(--type-caption-size)', color: 'var(--wb-ink-dim)', marginTop: 4, lineHeight: 1.5 }}>{ins.detail}</span>
              {clickable && (
                <span style={{ ...sans, display: 'block', fontSize: 'var(--type-caption-size)', color: 'var(--brand-a)', marginTop: 6 }}>
                  Inspect {ins.calls!.length === 1 ? 'call' : `${ins.calls!.length} calls`} →
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
