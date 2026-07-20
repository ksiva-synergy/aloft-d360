// @vitest-environment jsdom
/**
 * Phase-4 DOM harness — first tenant #2 (the deferred Phase-3 provenance-render
 * invariant).
 *
 * A `grounding: 'undefined'` blueprint item can be undefined for three visibly-
 * DIFFERENT reasons, and BlueprintStage renders `undefinedProvenance` into three
 * distinct Teach-nudge messages:
 *   - genuinely absent        → "not defined yet — define it"
 *   - a candidate def exists   → "defined but not governed — govern it"
 *   - absence unproven (topK)  → "may exist beyond search — confirm or define"
 * Collapsing these to one "define it" nudge is the Pin-2 false-green — a
 * capped-but-real metric mis-surfaced as genuinely absent. Only a render
 * assertion distinguishes them; the store carries all three identically.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueprintStage } from '../BlueprintStage';
import { useBuilderStore } from '../../builder-store';
import type { ChartBlueprint, GuidedBlueprint, ResolvedIntent } from '@/lib/dashboards/guided-types';

const INTENT: ResolvedIntent = { modelId: 'model_1', topic: 'safety', relevantMeasureIds: [], relevantDimensionIds: [] };

function undefinedItem(id: string, term: string, extra: Partial<ChartBlueprint>): ChartBlueprint {
  return {
    id, title: term, measureIds: [], dimensionIds: [], measureLabels: [], dimensionLabels: [],
    filters: [], chartKindGuess: 'table', rationale: '', grounding: 'undefined', undefinedTerm: term, ...extra,
  };
}

describe('BlueprintStage — cap-aware undefinedProvenance (Phase-3 render invariant)', () => {
  beforeEach(() => {
    useBuilderStore.getState().clearGuidedSession();
    // Blueprint pre-seeded → BlueprintStage reuses it and does NOT fetch.
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('no fetch expected'));
    const bp: GuidedBlueprint = {
      modelId: 'model_1',
      modelStatus: 'governed',
      items: [
        undefinedItem('bp_absent', 'near-miss rate', {}),
        undefinedItem('bp_candidate', 'crew fatigue index', { undefinedProvenance: { candidateExists: true } }),
        undefinedItem('bp_capped', 'weather severity', { undefinedProvenance: { cappedByTopK: true } }),
      ],
    };
    useBuilderStore.getState().setBlueprint(bp);
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the three provenance states as visibly distinct nudges', () => {
    render(<BlueprintStage modelId="model_1" intent={INTENT} />);

    // Genuinely absent — "define it".
    expect(screen.getByText(/not defined yet — define it in Teach/i)).toBeInTheDocument();
    // A real-but-not-promoted def exists — "govern it", NOT "define from scratch".
    expect(screen.getByText(/defined but not governed — govern it in Teach/i)).toBeInTheDocument();
    // Absence UNPROVEN (top-K cap) — must not be reported as genuinely absent.
    expect(screen.getByText(/may exist beyond search — confirm or define in Teach/i)).toBeInTheDocument();
  });

  it('carries the raw undefined term on each nudge for the Teach prefill', () => {
    const { container } = render(<BlueprintStage modelId="model_1" intent={INTENT} />);
    const terms = Array.from(container.querySelectorAll('[data-undefined-term]')).map((n) => n.getAttribute('data-undefined-term'));
    expect(terms).toContain('near-miss rate');
    expect(terms).toContain('crew fatigue index');
    expect(terms).toContain('weather severity');
  });
});
