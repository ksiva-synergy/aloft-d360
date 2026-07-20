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

  it('no curate op ever creates a widget', () => {
    useBuilderStore.getState().reorderBlueprintItem(0, 1);
    useBuilderStore.getState().renameBlueprintItem('a', 'x');
    useBuilderStore.getState().removeBlueprintItem('c');
    useBuilderStore.getState().addBlueprintItem(item('e', 'Echo'));
    expect(useBuilderStore.getState().widgets).toEqual([]);
  });
});
