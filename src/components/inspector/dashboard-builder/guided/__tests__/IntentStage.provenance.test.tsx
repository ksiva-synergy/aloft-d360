// @vitest-environment jsdom
/**
 * Phase-4 DOM harness — first tenant #1 (the deferred Phase-2 provenance-render
 * invariant that no pure-logic test can guard).
 *
 * IntentStage seeds starter topics from platform_nl_intent_embeddings rows. Each
 * governed chip MUST carry its `data-intent-source-id` so it traces to a real
 * row, and a row WITHOUT provenance (no sourceId) MUST be dropped — never
 * rendered as anonymous filler. This is the seam-6 "dead starter" false-green:
 * it silently regresses in the render layer while every store/logic test stays
 * green. Only a render assertion catches it.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntentStage } from '../IntentStage';
import { useBuilderStore } from '../../builder-store';

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe('IntentStage — starter-topic provenance chips (Phase-2 render invariant)', () => {
  beforeEach(() => {
    useBuilderStore.getState().clearGuidedSession();
    vi.spyOn(global, 'fetch').mockImplementation(((url: string) => {
      if (url.includes('/intents')) {
        return Promise.resolve(
          jsonResponse({
            intents: [
              // Real, provenance-bearing governed row → renders as a chip.
              { intentText: 'Which root causes drive accidents?', label: 'Accident count', sourceType: 'measure', sourceId: 'meas_root_cause' },
              // No sourceId → NOT traceable → must be dropped, not shown as filler.
              { intentText: 'Filler with no provenance', label: 'ghost', sourceType: 'measure', sourceId: '' },
            ],
          }),
        );
      }
      if (url.includes('/definitions')) return Promise.resolve(jsonResponse({ model: { name: 'Safety' } }));
      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders data-intent-source-id on the real chip and drops the provenance-less row', async () => {
    const { container } = render(<IntentStage modelId="model_1" />);

    // The real starter renders...
    await screen.findByText('Which root causes drive accidents?');

    // ...carrying its embedding-row provenance.
    const chips = container.querySelectorAll('[data-intent-source-id]');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('data-intent-source-id', 'meas_root_cause');
    expect(chips[0]).toHaveAttribute('data-intent-source-type', 'measure');

    // The provenance-less row is dropped entirely — never rendered as filler.
    expect(screen.queryByText('Filler with no provenance')).not.toBeInTheDocument();
  });
});
