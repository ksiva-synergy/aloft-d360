'use client';

import React from 'react';
import { Sprout, DownloadCloud, HelpCircle } from 'lucide-react';
import { MONO, SANS, SERIF, MUTED, INK, INK_DIM, BORDER, GOLD } from './mc-ui';

/**
 * Empty-model state — shown when the org has no model, or the active model has
 * no definitions. Renders the "let's seed it" hero rather than a blank table.
 * The actual schema-scan bootstrap is net-new, so its CTA is stubbed (disabled
 * with a tooltip) — honest, not a dead button pretending to work.
 */

const STARTERS = [
  'How many deficiencies per vessel this quarter?',
  'Which flags have the most detentions?',
  'Average time to close a defect by inspection type',
];

export function EmptyModelState({ reason }: { reason: 'no-model' | 'no-defs' }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: 14, borderRadius: '50%', background: 'rgba(253,181,21,0.1)', marginBottom: 16 }}>
          <Sprout size={26} color={GOLD} />
        </div>
        <div style={{ ...SERIF, fontSize: 22, fontWeight: 600, color: INK, marginBottom: 8 }}>
          {reason === 'no-model' ? 'No semantic model yet.' : 'An empty model. Let’s seed it.'}
        </div>
        <p style={{ ...SANS, fontSize: 13, color: INK_DIM, lineHeight: 1.6, marginBottom: 20 }}>
          {reason === 'no-model'
            ? 'Harvest a model in the Inspector, or scan a source schema to bootstrap one.'
            : 'This model has no definitions. Scan a source schema to propose themes and starter questions.'}
        </p>

        <button
          disabled
          title="Schema scan bootstrap is not enabled yet."
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, ...MONO, fontSize: 12, fontWeight: 600,
            padding: '9px 16px', borderRadius: 5, cursor: 'not-allowed', opacity: 0.5,
            border: `1px solid ${GOLD}`, background: 'transparent', color: GOLD,
          }}
        >
          <DownloadCloud size={15} /> Scan a source schema
        </button>

        <div style={{ marginTop: 26, textAlign: 'left' }}>
          <div style={{ ...MONO, fontSize: 9, color: MUTED, letterSpacing: '0.08em', marginBottom: 8 }}>STARTER QUESTIONS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {STARTERS.map((q) => (
              <div key={q} style={{ display: 'flex', alignItems: 'center', gap: 8, ...SANS, fontSize: 12, color: INK_DIM, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '8px 10px' }}>
                <HelpCircle size={13} color={MUTED} style={{ flexShrink: 0 }} /> {q}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
