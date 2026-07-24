import { describe, it, expect, beforeEach } from 'vitest';
import { useBuilderStore } from '../builder-store';
import type { GuidedBlueprint, ChartBlueprint } from '@/lib/dashboards/guided-types';

function item(id: string, title: string, grounding: ChartBlueprint['grounding'] = 'governed'): ChartBlueprint {
  return {
    id, title,
    measureIds: grounding === 'governed' ? ['meas_x'] : [],
    dimensionIds: [], measureLabels: grounding === 'governed' ? ['X'] : [], dimensionLabels: [],
    filters: [], chartKindGuess: 'bar', rationale: 'why', grounding,
    ...(grounding === 'undefined' ? { undefinedTerm: title } : {}),
  };
}

const blueprint: GuidedBlueprint = {
  modelId: 'model_abc',
  modelStatus: 'governed',
  items: [item('a', 'Alpha'), item('b', 'Beta'), item('c', 'Gamma')],
};

describe('builder-store — blueprint slice', () => {
  beforeEach(() => {
    useBuilderStore.getState().clearGuidedSession();
    useBuilderStore.getState().loadWidgets([]);
  });

  it('starts with a null blueprint', () => {
    expect(useBuilderStore.getState().guidedSession.blueprint).toBeNull();
  });

  it('emits the blueprint losslessly (round-trip)', () => {
    useBuilderStore.getState().setBlueprint(blueprint);
    expect(useBuilderStore.getState().guidedSession.blueprint).toEqual(blueprint);
  });

  it('setting the blueprint does NOT build any widgets', () => {
    useBuilderStore.getState().setBlueprint(blueprint);
    // Accepting a blueprint is a Phase-4 handoff; the store must hold no widgets yet.
    expect(useBuilderStore.getState().widgets).toEqual([]);
  });

  it('clearGuidedSession resets both intent and blueprint', () => {
    useBuilderStore.getState().setBlueprint(blueprint);
    useBuilderStore.getState().clearGuidedSession();
    expect(useBuilderStore.getState().guidedSession.blueprint).toBeNull();
    expect(useBuilderStore.getState().guidedSession.intent).toBeNull();
  });
});

describe('builder-store — blueprint curate ops mutate ONLY the blueprint', () => {
  beforeEach(() => {
    useBuilderStore.getState().clearGuidedSession();
    useBuilderStore.getState().loadWidgets([]);
    useBuilderStore.getState().setBlueprint(structuredClone(blueprint));
  });

  it('reorder moves an item and preserves the rest', () => {
    useBuilderStore.getState().reorderBlueprintItem(0, 2); // Alpha to the end
    expect(useBuilderStore.getState().guidedSession.blueprint!.items.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('reorder is a no-op for out-of-range indices', () => {
    useBuilderStore.getState().reorderBlueprintItem(0, 9);
    expect(useBuilderStore.getState().guidedSession.blueprint!.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('rename edits a single item inline', () => {
    useBuilderStore.getState().renameBlueprintItem('b', 'Beta renamed');
    const items = useBuilderStore.getState().guidedSession.blueprint!.items;
    expect(items.find((i) => i.id === 'b')!.title).toBe('Beta renamed');
  });

  it('remove deletes a single item', () => {
    useBuilderStore.getState().removeBlueprintItem('b');
    expect(useBuilderStore.getState().guidedSession.blueprint!.items.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('add appends an item', () => {
    useBuilderStore.getState().addBlueprintItem(item('d', 'Delta', 'undefined'));
    expect(useBuilderStore.getState().guidedSession.blueprint!.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('updateBlueprintItem patches one item in place, leaving the rest intact', () => {
    useBuilderStore.getState().updateBlueprintItem('b', { title: 'Beta v2', rationale: 'new why', chartKindGuess: 'line' });
    const items = useBuilderStore.getState().guidedSession.blueprint!.items;
    const b = items.find((i) => i.id === 'b')!;
    expect(b.title).toBe('Beta v2');
    expect(b.rationale).toBe('new why');
    expect(b.chartKindGuess).toBe('line');
    // order + siblings untouched
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(items.find((i) => i.id === 'a')!.title).toBe('Alpha');
  });

  it('updateBlueprintItem flips an undefined item to grounded (the inline-define path)', () => {
    useBuilderStore.getState().addBlueprintItem(item('u', 'near-miss rate', 'undefined'));
    useBuilderStore.getState().updateBlueprintItem('u', {
      grounding: 'governed',
      undefinedTerm: undefined,
      measureIds: ['meas_new'],
      measureLabels: ['Near-miss rate'],
      pendingDefinition: { id: 'meas_new', tableKind: 'measure', label: 'Near-miss rate', tier: 'candidate' },
    });
    const u = useBuilderStore.getState().guidedSession.blueprint!.items.find((i) => i.id === 'u')!;
    expect(u.grounding).toBe('governed');
    expect(u.undefinedTerm).toBeUndefined();
    expect(u.measureIds).toEqual(['meas_new']);
    expect(u.pendingDefinition).toEqual({ id: 'meas_new', tableKind: 'measure', label: 'Near-miss rate', tier: 'candidate' });
  });

  it('updateBlueprintItem is a no-op for an unknown id', () => {
    useBuilderStore.getState().updateBlueprintItem('nope', { title: 'X' });
    expect(useBuilderStore.getState().guidedSession.blueprint!.items.map((i) => i.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('no curate op ever creates a widget', () => {
    useBuilderStore.getState().reorderBlueprintItem(0, 1);
    useBuilderStore.getState().renameBlueprintItem('a', 'x');
    useBuilderStore.getState().removeBlueprintItem('c');
    useBuilderStore.getState().addBlueprintItem(item('e', 'Echo'));
    useBuilderStore.getState().updateBlueprintItem('a', { title: 'y' });
    expect(useBuilderStore.getState().widgets).toEqual([]);
  });
});
