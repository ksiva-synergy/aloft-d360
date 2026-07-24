import { describe, it, expect } from 'vitest';
import { buildRefineItemSystemPrompt } from '../blueprint-propose';
import type { GroundingCatalog } from '../blueprint-ground';
import type { ChartBlueprint, ResolvedIntent } from '../guided-types';

const INTENT: ResolvedIntent = {
  modelId: 'model_1',
  topic: 'vessel safety performance',
  relevantMeasureIds: [],
  relevantDimensionIds: [],
};

const CATALOG: GroundingCatalog = {
  measures: [
    { id: 'meas_incidents', label: 'Total Incidents' },
    { id: 'meas_lti', label: 'Lost Time Injuries' },
  ],
  dimensions: [{ id: 'dim_vessel', label: 'Vessel', type: 'categorical' }],
};

const ITEM: ChartBlueprint = {
  id: 'bp_2',
  title: 'Incidents by vessel',
  measureIds: ['meas_incidents'],
  dimensionIds: ['dim_vessel'],
  measureLabels: ['Total Incidents'],
  dimensionLabels: ['Vessel'],
  filters: [],
  chartKindGuess: 'bar',
  rationale: 'shows which vessels drive incidents',
  grounding: 'governed',
};

describe('buildRefineItemSystemPrompt', () => {
  const prompt = buildRefineItemSystemPrompt(INTENT, CATALOG, ITEM, 'make it a line by month');

  it('frames the task as refining exactly ONE chart', () => {
    expect(prompt).toMatch(/REFINING ONE chart/i);
    expect(prompt).toMatch(/EXACTLY ONE chart/i);
    expect(prompt).toMatch(/single-element `charts` array/i);
  });

  it("embeds the user's feedback and the intent topic", () => {
    expect(prompt).toContain('make it a line by month');
    expect(prompt).toContain('vessel safety performance');
  });

  it('renders the existing item so the model refines rather than starts over', () => {
    expect(prompt).toContain('Incidents by vessel');
    expect(prompt).toContain('Total Incidents');
    expect(prompt).toContain('Vessel');
    expect(prompt).toContain('bar');
  });

  it('renders the governed catalog by id', () => {
    expect(prompt).toContain('meas_incidents');
    expect(prompt).toContain('meas_lti');
    expect(prompt).toContain('dim_vessel');
  });

  it('instructs keep-title-unless-changed and refuse-rather-than-guess (undefinedTerm)', () => {
    expect(prompt).toMatch(/keep the existing title/i);
    expect(prompt).toMatch(/undefinedTerm/);
    expect(prompt).toMatch(/never invent an id/i);
  });

  it('surfaces an undefined item as its define-it context', () => {
    const undef: ChartBlueprint = {
      ...ITEM, id: 'bp_3', grounding: 'undefined', undefinedTerm: 'near-miss rate',
      measureIds: [], measureLabels: [],
    };
    const p = buildRefineItemSystemPrompt(INTENT, CATALOG, undef, 'exclude near misses');
    expect(p).toMatch(/UNDEFINED/);
    expect(p).toContain('near-miss rate');
  });
});
