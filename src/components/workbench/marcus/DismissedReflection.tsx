import React, { useState } from 'react';
import { type } from '@/lib/typography/tokens';

export interface DismissedReflectionProps {
  technique: string;
  summary: string;
  onExpand: () => void;
}

export function DismissedReflection({ technique, summary, onExpand }: DismissedReflectionProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        backgroundColor: 'transparent',
        borderLeft: hovered ? '3px solid color-mix(in srgb, var(--brand-a) 40%, transparent)' : '3px solid color-mix(in srgb, var(--brand-a) 18%, transparent)',
        padding: '10px 0 10px 24px',
        marginTop: '8px',
        marginBottom: '4px',
        cursor: 'pointer',
        transition: 'border-color 0.15s'
      }}
      onClick={onExpand}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
        <div style={{
          ...type.label,
          color: '#5a6a82',
          flexShrink: 0,
        }}>
          <span style={{ color: 'color-mix(in srgb, var(--brand-a) 45%, transparent)' }}>CAPTAIN TRACK SPARROW</span> · {technique.replace(/_/g, ' ')}
        </div>
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--type-ui-regular-size)',
          color: '#5a6a82',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {summary}
        </div>
      </div>
      
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--type-ui-regular-size)',
        color: '#5a6a82',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.15s',
        paddingLeft: '16px',
      }}>
        ↗ expand
      </div>
    </div>
  );
}
