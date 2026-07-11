import React, { useState } from 'react';

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
        borderLeft: hovered ? '3px solid rgba(253,181,21,0.4)' : '3px solid rgba(253,181,21,0.18)',
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
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#5a6a82',
          flexShrink: 0,
        }}>
          <span style={{ color: 'rgba(253,181,21,0.45)' }}>MARCUS</span> · {technique.replace(/_/g, ' ')}
        </div>
        <div style={{
          fontFamily: "'Inter Tight', system-ui, sans-serif",
          fontSize: '12px',
          color: '#5a6a82',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {summary}
        </div>
      </div>
      
      <div style={{
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: '10px',
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
