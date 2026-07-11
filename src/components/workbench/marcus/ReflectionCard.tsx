import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const TECHNIQUE_LABELS: Record<string, string> = {
  self_examination:     'MARCUS · SELF-EXAMINATION',
  evening_review:       'MARCUS · REVIEW',
  premeditatio:         'MARCUS · PREMEDITATIO',
  necessity:            'MARCUS · NECESSITY',
  dichotomy_epictetus:  'STOIC · DICHOTOMY OF CONTROL',
  view_from_above:      'MARCUS · VIEW FROM ABOVE',
};

export interface ReflectionCardProps {
  id: string;
  triggerType: string;
  technique: string;
  headline: string;
  body: string;
  severity: 'note' | 'caution' | 'gate';
  suggestedAction?: {
    kind: string;
    target?: string;
    label?: string;
  } | null;
  onDismiss: (id: string) => void;
  onAcknowledge: (id: string) => void;
  onAct: (id: string, action: { kind: string; target?: string }) => void;
}

export function ReflectionCard({
  id,
  technique,
  headline,
  body,
  severity,
  suggestedAction,
  onDismiss,
  onAcknowledge,
  onAct,
}: ReflectionCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Delay slightly to appear after the stream
    const t = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  const label = TECHNIQUE_LABELS[technique] || `MARCUS · ${technique.toUpperCase()}`;
  const dotColor = severity === 'gate' ? '#e85a5a' : severity === 'caution' ? '#e8934a' : '#FDB515';

  if (!mounted) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{
        width: '100%',
        backgroundColor: '#0d1220',
        borderLeft: '3px solid #FDB515',
        borderTop: '1px solid rgba(253,181,21,0.06)',
        borderRight: '1px solid rgba(253,181,21,0.06)',
        borderBottom: '1px solid rgba(253,181,21,0.06)',
        borderRadius: '0 6px 6px 0',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        marginTop: '8px',
        marginBottom: '4px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
        <div style={{
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#FDB515',
        }}>
          {label}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{
          fontFamily: "'Source Serif 4', Georgia, serif",
          fontStyle: 'italic',
          fontSize: '17px',
          fontWeight: 400,
          color: '#e8e6e1',
        }}>
          {headline}
        </div>
        <div style={{
          fontFamily: "'Inter Tight', system-ui, sans-serif",
          fontSize: '14px',
          color: '#8b9ab5',
          lineHeight: 1.55,
        }}>
          {body}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
        {suggestedAction ? (
          <button
            onClick={() => onAct(id, suggestedAction)}
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: '11px',
              fontWeight: 500,
              padding: '6px 14px',
              borderRadius: '6px',
              backgroundColor: '#1a2236',
              border: '1px solid rgba(253,181,21,0.4)',
              color: '#FDB515',
              cursor: 'pointer',
              transition: 'background-color 0.15s, border-color 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1e2840'; e.currentTarget.style.borderColor = 'rgba(253,181,21,0.6)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#1a2236'; e.currentTarget.style.borderColor = 'rgba(253,181,21,0.4)'; }}
          >
            {suggestedAction.label || 'Take Action'}
          </button>
        ) : (
          <button
            onClick={() => onAcknowledge(id)}
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: '11px',
              fontWeight: 500,
              padding: '6px 14px',
              borderRadius: '6px',
              backgroundColor: '#1a2236',
              border: '1px solid rgba(253,181,21,0.2)',
              color: '#FDB515',
              cursor: 'pointer',
              transition: 'background-color 0.15s, border-color 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1e2840'; e.currentTarget.style.borderColor = 'rgba(253,181,21,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#1a2236'; e.currentTarget.style.borderColor = 'rgba(253,181,21,0.2)'; }}
          >
            Acknowledge
          </button>
        )}
        <button
          onClick={() => onDismiss(id)}
          style={{
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: '11px',
            fontWeight: 500,
            padding: '6px 14px',
            borderRadius: '6px',
            backgroundColor: '#1a2236',
            border: '1px solid rgba(255,255,255,0.06)',
            color: '#5a6a82',
            cursor: 'pointer',
            transition: 'color 0.15s, background-color 0.15s'
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#8b9ab5'; e.currentTarget.style.backgroundColor = '#1e2840'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#5a6a82'; e.currentTarget.style.backgroundColor = '#1a2236'; }}
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}
