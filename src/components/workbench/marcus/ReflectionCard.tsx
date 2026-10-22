import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const TECHNIQUE_LABELS: Record<string, string> = {
  self_examination:     'CAPTAIN TRACK SPARROW · SELF-EXAMINATION',
  evening_review:       'CAPTAIN TRACK SPARROW · REVIEW',
  premeditatio:         'CAPTAIN TRACK SPARROW · PREMEDITATIO',
  necessity:            'CAPTAIN TRACK SPARROW · NECESSITY',
  dichotomy_epictetus:  'STOIC · DICHOTOMY OF CONTROL',
  view_from_above:      'CAPTAIN TRACK SPARROW · VIEW FROM ABOVE',
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

  const label = TECHNIQUE_LABELS[technique] || `CAPTAIN TRACK SPARROW · ${technique.toUpperCase()}`;
  const dotColor = severity === 'gate' ? '#e85a5a' : severity === 'caution' ? '#e8934a' : 'var(--brand-a)';

  if (!mounted) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{
        width: '100%',
        backgroundColor: 'var(--surface-1)',
        borderLeft: '3px solid var(--brand-a)',
        borderTop: '1px solid color-mix(in srgb, var(--brand-a) 6%, transparent)',
        borderRight: '1px solid color-mix(in srgb, var(--brand-a) 6%, transparent)',
        borderBottom: '1px solid color-mix(in srgb, var(--brand-a) 6%, transparent)',
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
          fontSize: '13px',
          fontWeight: 500,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--brand-a-ink)',
        }}>
          {label}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{
          fontFamily: "'Inter Variable', 'Inter', system-ui, sans-serif",
          fontStyle: 'italic',
          fontSize: '17px',
          fontWeight: 400,
          color: 'var(--ink-1)',
        }}>
          {headline}
        </div>
        <div style={{
          fontFamily: "'Inter Variable', system-ui, sans-serif",
          fontSize: '14px',
          color: 'var(--ink-2)',
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
              fontSize: '13px',
              fontWeight: 500,
              padding: '6px 14px',
              borderRadius: '6px',
              backgroundColor: 'var(--surface-2)',
              border: '1px solid color-mix(in srgb, var(--brand-a) 40%, transparent)',
              color: 'var(--brand-a-ink)',
              cursor: 'pointer',
              transition: 'background-color 0.15s, border-color 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--surface-3)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--brand-a) 60%, transparent)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--brand-a) 40%, transparent)'; }}
          >
            {suggestedAction.label || 'Take Action'}
          </button>
        ) : (
          <button
            onClick={() => onAcknowledge(id)}
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: '13px',
              fontWeight: 500,
              padding: '6px 14px',
              borderRadius: '6px',
              backgroundColor: 'var(--surface-2)',
              border: '1px solid color-mix(in srgb, var(--brand-a) 20%, transparent)',
              color: 'var(--brand-a-ink)',
              cursor: 'pointer',
              transition: 'background-color 0.15s, border-color 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--surface-3)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--brand-a) 40%, transparent)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--brand-a) 20%, transparent)'; }}
          >
            Acknowledge
          </button>
        )}
        <button
          onClick={() => onDismiss(id)}
          style={{
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: '13px',
            fontWeight: 500,
            padding: '6px 14px',
            borderRadius: '6px',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--line-1)',
            color: 'var(--ink-3)',
            cursor: 'pointer',
            transition: 'color 0.15s, background-color 0.15s'
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--ink-2)'; e.currentTarget.style.backgroundColor = 'var(--surface-3)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}
