import { describe, it, expect } from 'vitest';
import {
  groundBlueprint,
  BLUEPRINT_MAX_ITEMS,
  type GroundingCatalog,
  type RawBlueprintItem,
} from '../blueprint-ground';
import type { IntentDisambiguation } from '../guided-types';

// ── A small governed catalog ─────────────────────────────────────────────────
const catalog: GroundingCatalog = {
  measures: [{ id: 'meas_accidents', label: 'Accident count' }],
  dimensions: [
    { id: 'dim_vessel', label: 'Vessel', type: 'categorical' },
    { id: 'dim_month', label: 'Month', type: 'temporal' },
    { id: 'dim_root_cause', label: 'Root cause category', type: 'categorical' },
  ],
};

const CATALOG_IDS = new Set<string>([
  ...catalog.measures.map((m) => m.id),
  ...catalog.dimensions.map((d) => d.id),
]);

/** Every field id used anywhere in a grounded blueprint. */
function allIds(items: ReturnType<typeof groundBlueprint>): string[] {
  return items.flatMap((i) => [
    ...i.measureIds,
    ...i.dimensionIds,
    ...i.filters.map((f) => f.fieldId),
  ]);
}

describe('groundBlueprint — the refuse-rather-than-guess guarantee', () => {
  // THE load-bearing test. A proposal that names a plausible-but-undefined metric
  // — both as a fabricated id AND as an honest undefinedTerm — must never yield an
  // invented id ANYWHERE, and must surface a define-it item instead.
  it('never emits a fabricated id, and surfaces the undefined term as a define-it item', () => {
    const raw: RawBlueprintItem[] = [
      { title: 'Accidents by root cause', measureIds: ['meas_accidents'], dimensionIds: ['dim_root_cause'] },
      // Model honestly flags a metric that isn't governed:
      { title: 'Near-miss rate', undefinedTerm: 'near-miss rate', measureIds: [] },
      // Model MISBEHAVES: invents an id (and even attaches a real dim):
      { title: 'Fuel efficiency', measureIds: ['meas_FABRICATED_fuel_eff'], dimensionIds: ['dim_vessel'], undefinedTerm: 'fuel efficiency' },
      // Model invents an id with NO term — must still not leak the id:
      { title: 'Mystery metric', measureIds: ['meas_bogus_xyz'] },
    ];

    const items = groundBlueprint(raw, catalog);

    // 1. GUARANTEE: every id in the output is a member of the catalog.
    for (const id of allIds(items)) {
      expect(CATALOG_IDS.has(id)).toBe(true);
    }
    // 2. No fabricated id string appears anywhere in the serialized response.
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('meas_FABRICATED_fuel_eff');
    expect(serialized).not.toContain('meas_bogus_xyz');

    // 3. The undefined metric is surfaced as a define-it item carrying the term.
    const nearMiss = items.find((i) => i.undefinedTerm === 'near-miss rate');
    expect(nearMiss).toBeDefined();
    expect(nearMiss!.grounding).toBe('undefined');
    expect(nearMiss!.measureIds).toEqual([]);

    // 4. A fabricated-id item is downgraded to undefined (never a governed chart),
    //    while a real dimension it referenced is still kept (partial grounding).
    const fuel = items.find((i) => i.undefinedTerm === 'fuel efficiency');
    expect(fuel!.grounding).toBe('undefined');
    expect(fuel!.measureIds).toEqual([]);
    expect(fuel!.dimensionIds).toEqual(['dim_vessel']); // real dim survives; fake measure dropped

    // 5. The termless fabrication falls back to its title, still no invented id.
    const mystery = items.find((i) => i.title === 'Mystery metric');
    expect(mystery!.grounding).toBe('undefined');
    expect(mystery!.undefinedTerm).toBe('Mystery metric');
    expect(mystery!.measureIds).toEqual([]);
  });

  it('carries resolved labels beside ids so the card needs no second lookup', () => {
    const items = groundBlueprint(
      [{ title: 'Accidents by root cause', measureIds: ['meas_accidents'], dimensionIds: ['dim_root_cause'] }],
      catalog,
    );
    expect(items[0].grounding).toBe('governed');
    expect(items[0].measureIds).toEqual(['meas_accidents']);
    expect(items[0].measureLabels).toEqual(['Accident count']);
    expect(items[0].dimensionLabels).toEqual(['Root cause category']);
  });

  it('drops a filter whose fieldId is not a governed field (same guarantee for filters)', () => {
    const items = groundBlueprint(
      [{
        title: 'Accidents', measureIds: ['meas_accidents'],
        filters: [
          { fieldId: 'dim_vessel', fieldKind: 'dimension', op: 'eq', value: 'X' },      // real → kept
          { fieldId: 'dim_FAKE', fieldKind: 'dimension', op: 'eq', value: 'Y' },         // fake → dropped
        ],
      }],
      catalog,
    );
    expect(items[0].filters).toHaveLength(1);
    expect(items[0].filters[0].fieldId).toBe('dim_vessel');
    expect(JSON.stringify(items)).not.toContain('dim_FAKE');
  });
});

describe('groundBlueprint — chartKindGuess is a CALL into recommendChartKind', () => {
  // Field combination → kind mapping is the shipped recommender's, not new logic.
  it('1 measure, 0 dims → kpi', () => {
    const items = groundBlueprint([{ title: 'Total', measureIds: ['meas_accidents'] }], catalog);
    expect(items[0].chartKindGuess).toBe('kpi');
  });
  it('1 temporal dim + measure → line', () => {
    const items = groundBlueprint([{ title: 'Trend', measureIds: ['meas_accidents'], dimensionIds: ['dim_month'] }], catalog);
    expect(items[0].chartKindGuess).toBe('line');
  });
  it('1 categorical dim + measure → bar', () => {
    const items = groundBlueprint([{ title: 'By vessel', measureIds: ['meas_accidents'], dimensionIds: ['dim_vessel'] }], catalog);
    expect(items[0].chartKindGuess).toBe('bar');
  });
  it('2 dims + measure → heatmap', () => {
    const items = groundBlueprint(
      [{ title: 'Matrix', measureIds: ['meas_accidents'], dimensionIds: ['dim_vessel', 'dim_root_cause'] }],
      catalog,
    );
    expect(items[0].chartKindGuess).toBe('heatmap');
  });
});

describe('groundBlueprint — undefined provenance mirrors the resolved intent (Pin-2)', () => {
  const disambiguations: IntentDisambiguation[] = [
    { term: 'near-miss rate', resolution: 'not_governed', candidates: [{ id: 'x', label: 'Near miss' }] },
    { term: 'fuel efficiency', resolution: 'unrecognized', candidates: [], cappedByTopK: true },
  ];
  const catalogWithIntent: GroundingCatalog = { ...catalog, disambiguations };

  it('marks candidateExists when a real-but-not-governed def matched the term', () => {
    const items = groundBlueprint([{ title: 'Near miss', undefinedTerm: 'near-miss rate' }], catalogWithIntent);
    expect(items[0].undefinedProvenance?.candidateExists).toBe(true);
    expect(items[0].undefinedProvenance?.cappedByTopK).toBeUndefined();
  });

  it('marks cappedByTopK when absence is unproven (a capped-but-real metric is not mis-nudged)', () => {
    const items = groundBlueprint([{ title: 'Fuel', undefinedTerm: 'fuel efficiency' }], catalogWithIntent);
    expect(items[0].undefinedProvenance?.cappedByTopK).toBe(true);
  });

  it('genuinely-absent term carries no provenance flags', () => {
    const items = groundBlueprint([{ title: 'Sasquatch', undefinedTerm: 'sasquatch sightings' }], catalogWithIntent);
    expect(items[0].undefinedProvenance).toBeUndefined();
  });
});

describe('groundBlueprint — caps the list (no silent over-coverage)', () => {
  it(`returns at most ${BLUEPRINT_MAX_ITEMS} items`, () => {
    const raw: RawBlueprintItem[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Chart ${i}`, measureIds: ['meas_accidents'], dimensionIds: ['dim_vessel'],
    }));
    const items = groundBlueprint(raw, catalog);
    expect(items.length).toBe(BLUEPRINT_MAX_ITEMS);
  });
});
