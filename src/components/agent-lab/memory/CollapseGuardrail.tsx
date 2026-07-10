'use client';

import React from 'react';
import { GOLD, RULE_TYPE_COLORS, BODY, MONO, BG_DARK } from '@/lib/foer/foer-tokens';

export function CollapseGuardrail() {
  return (
    <div
      style={{
        width:          '100%',
        marginTop:      '32px',
        background:     'var(--foer-card-bg)',
        border:         '1px solid var(--foer-border)',
        borderLeft:     `2px solid var(--foer-gold, ${GOLD})`,
        borderRadius:   '6px',
        padding:        '16px 18px',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            '1.25rem',
        fontFamily:     BODY,
      }}
    >
      <div
        style={{
          fontSize: '0.8rem',
          lineHeight: '1.4',
          color: 'var(--foer-text-sec)',
        }}
      >
        Foer only ever applies deltas. ACE Step 60→61 — one monolithic rewrite collapsed 18,282 tokens → 122, accuracy below baseline. Not here.
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <svg
          width="96"
          height="44"
          viewBox="0 0 96 44"
          style={{ display: 'block' }}
          aria-label="Before/after collapse illustration"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 2 L 6 5 L 0 8 z" fill="var(--foer-text-mut)" />
            </marker>
          </defs>

          {/* Tall gold bar representing 18,282 tokens */}
          <rect x="4" y="4" width="24" height="30" fill={GOLD} rx="2" />
          <text
            x="16"
            y="22"
            fill={BG_DARK}
            fontSize="6"
            fontFamily={MONO}
            fontWeight="bold"
            textAnchor="middle"
          >
            18,282
          </text>

          {/* Arrow */}
          <path
            d="M 34 20 L 48 20"
            stroke="var(--foer-text-mut)"
            strokeWidth="1"
            fill="none"
            markerEnd="url(#arrow)"
          />

          {/* Tiny sliver representing 122 tokens */}
          <rect
            x="56"
            y="30"
            width="24"
            height="4"
            fill="var(--foer-text-sec)"
            rx="1"
          />
          <text
            x="68"
            y="24"
            fill="var(--foer-text-sec)"
            fontSize="6.5"
            fontFamily={MONO}
            textAnchor="middle"
          >
            122
          </text>

          {/* Small red X stamp over the tiny bar */}
          <g stroke={RULE_TYPE_COLORS.FAILURE_MODE} strokeWidth="1.5" strokeLinecap="round" opacity="0.85">
            <line x1="58" y1="22" x2="78" y2="38" />
            <line x1="78" y1="22" x2="58" y2="38" />
          </g>
        </svg>
      </div>
    </div>
  );
}
