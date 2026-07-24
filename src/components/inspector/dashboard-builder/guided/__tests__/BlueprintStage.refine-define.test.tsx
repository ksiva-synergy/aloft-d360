// @vitest-environment jsdom
/**
 * Request 1 (per-chart feedback → regenerate) + Request 2 (inline define +
 * governance ladder), at the seams this component owns:
 *   - Regenerate POSTs the refine-item route and replaces the card in place.
 *   - An undefined card exposes an inline "define it here" affordance that opens
 *     the DefineMetricPanel (never the old Teach out-link).
 *   - A card carrying a draft pendingDefinition can Submit → flips to grounded;
 *     a candidate can Promote, and a 403 surfaces its gate reason (never a crash).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueprintStage } from '../BlueprintStage';
import { useBuilderStore } from '../../builder-store';
import type { ChartBlueprint, GuidedBlueprint, ResolvedIntent } from '@/lib/dashboards/guided-types';

const INTENT: ResolvedIntent = { modelId: 'model_1', topic: 'safety', relevantMeasureIds: [], relevantDimensionIds: [] };

function governedItem(id: string, title: string): ChartBlueprint {
  return {
    id, title, measureIds: ['meas_x'], dimensionIds: [], measureLabels: ['X'], dimensionLabels: [],
    filters: [], chartKindGuess: 'bar', rationale: 'why', grounding: 'governed',
  };
}
function undefinedItem(id: string, term: string, extra: Partial<ChartBlueprint> = {}): ChartBlueprint {
  return {
    id, title: term, measureIds: [], dimensionIds: [], measureLabels: [], dimensionLabels: [],
    filters: [], chartKindGuess: 'table', rationale: '', grounding: 'undefined', undefinedTerm: term, ...extra,
  };
}

function seed(items: ChartBlueprint[]) {
  const bp: GuidedBlueprint = { modelId: 'model_1', modelStatus: 'governed', items };
  useBuilderStore.getState().clearGuidedSession();
  useBuilderStore.getState().setBlueprint(bp);
}

const itemsNow = () => useBuilderStore.getState().guidedSession.blueprint!.items;

describe('BlueprintStage — regenerate from feedback (Request 1)', () => {
  beforeEach(() => useBuilderStore.getState().clearGuidedSession());
  afterEach(() => vi.restoreAllMocks());

  it('POSTs the refine-item route and replaces the card in place', async () => {
    seed([governedItem('a', 'Alpha')]);
    const refined: ChartBlueprint = {
      ...governedItem('a', 'Alpha by month'), chartKindGuess: 'line', rationale: 'trend over time',
    };
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ item: refined }), { status: 200 }),
    );

    render(<BlueprintStage modelId="model_1" intent={INTENT} />);

    fireEvent.click(screen.getByText(/give feedback \/ refine/i));
    fireEvent.change(screen.getByLabelText(/feedback for this chart/i), { target: { value: 'make it a line by month' } });
    fireEvent.click(screen.getByText(/regenerate chart/i));

    await waitFor(() => expect(itemsNow()[0].chartKindGuess).toBe('line'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/inspector/semantic/model_1/blueprint/refine-item');
    expect(JSON.parse(String((init as RequestInit).body)).feedback).toBe('make it a line by month');
    // id preserved so it replaced in place (not appended)
    expect(itemsNow()).toHaveLength(1);
    expect(itemsNow()[0].id).toBe('a');
    expect(itemsNow()[0].rationale).toBe('trend over time');
  });

  it('a refine that returns an undefined item surfaces the inline-define path', async () => {
    seed([governedItem('a', 'Alpha')]);
    const asUndefined = undefinedItem('a', 'near-miss rate');
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ item: asUndefined }), { status: 200 }),
    );

    render(<BlueprintStage modelId="model_1" intent={INTENT} />);
    fireEvent.click(screen.getByText(/give feedback \/ refine/i));
    fireEvent.change(screen.getByLabelText(/feedback for this chart/i), { target: { value: 'exclude near misses' } });
    fireEvent.click(screen.getByText(/regenerate chart/i));

    // Classifier outcome: the card now offers to define the term inline.
    await waitFor(() => expect(itemsNow()[0].grounding).toBe('undefined'));
    expect(screen.getByText(/not defined yet — define it here/i)).toBeInTheDocument();
  });
});

describe('BlueprintStage — inline define + governance ladder (Request 2)', () => {
  beforeEach(() => useBuilderStore.getState().clearGuidedSession());
  afterEach(() => vi.restoreAllMocks());

  it('the undefined affordance opens the DefineMetricPanel (not a Teach out-link)', async () => {
    seed([undefinedItem('u', 'near-miss rate')]);
    // DefineMetricPanel loads authoring-meta on mount — return an empty model.
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ entities: [] }), { status: 200 }),
    );
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<BlueprintStage modelId="model_1" intent={INTENT} />);
    fireEvent.click(screen.getByText(/not defined yet — define it here/i));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/define a metric/i)).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled(); // the old window.open path is gone
  });

  it('Submit for governance flips a draft-defined item to grounded', async () => {
    seed([undefinedItem('u', 'near-miss rate', {
      pendingDefinition: { id: 'meas_new', tableKind: 'measure', label: 'Near-miss rate', tier: 'draft' },
    })]);
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ submitted: ['meas_new'], errors: [] }), { status: 200 }),
    );

    render(<BlueprintStage modelId="model_1" intent={INTENT} />);
    fireEvent.click(screen.getByText(/submit for governance/i));

    await waitFor(() => expect(itemsNow()[0].grounding).toBe('governed'));
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/inspector/semantic/model_1/submit');
    const flipped = itemsNow()[0];
    expect(flipped.measureIds).toEqual(['meas_new']);
    expect(flipped.measureLabels).toEqual(['Near-miss rate']);
    expect(flipped.undefinedTerm).toBeUndefined();
    expect(flipped.pendingDefinition!.tier).toBe('candidate');
  });

  it('Promote surfaces the reputation-gate reason on a 403 without crashing', async () => {
    seed([{
      ...governedItem('u', 'Near-miss rate'),
      pendingDefinition: { id: 'meas_new', tableKind: 'measure', label: 'Near-miss rate', tier: 'candidate' },
    }]);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'not authorized to promote', reason: 'requires admin approval' }), { status: 403 }),
    );

    render(<BlueprintStage modelId="model_1" intent={INTENT} />);
    fireEvent.click(screen.getByText(/promote to governed/i));

    expect(await screen.findByText(/requires admin approval/i)).toBeInTheDocument();
    // still a candidate — no false promotion
    expect(itemsNow()[0].pendingDefinition!.tier).toBe('candidate');
  });
});
