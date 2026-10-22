import { describe, expect, it } from 'vitest';
import { constructionStateSchema } from '../constructionState';
import { applyUserEdit } from '../user-edits';
import { catalogSyncFromState, runtimeBriefFromCatalog, workbenchSessionIdFromConfig } from '../catalog-sync';
import { buildRuntimeSystemPrompt, buildTestRunSystemPrompt } from '../prompts';

const INSTRUCTIONS = 'Answer bunker variance questions for the fleet using the weekly bunker report.';

function draft(overrides: Record<string, unknown> = {}) {
  return constructionStateSchema.parse({ memory: { buildContext: { orgId: 'org-1' } }, ...overrides });
}

describe('catalogSyncFromState', () => {
  const catalog = {
    name: 'Old name',
    slug: 'bunker-watch-abc',
    description: 'old description',
    tags: ['feynman', 'workbench', 'fleet'],
    config: { platformAgentId: 'plat_1', agent_class: 'feynman', source: { workbenchSessionId: 'sess-1' } },
  };

  it('writes the saved agent fields and keeps the slug identity', () => {
    const state = draft({
      readiness: 'commission',
      name: 'Bunker Watch',
      class: { id: 'fermi', source: 'chosen', confidence: 1, skillRef: null },
      prompt: { instructions: INSTRUCTIONS, persona: 'Helps ops' },
      tools: {
        datasources: [{ kind: 'databricks', ref: 'synergy_dwh.ops.bunker', scope: null }],
        actions: [{ toolId: 'execute_tool', tier: 'governed' }],
      },
    });

    const patch = catalogSyncFromState(state, catalog);

    expect(patch.name).toBe('Bunker Watch');
    expect(patch.description).toBe('Helps ops');
    expect(patch.tags).toEqual(['fleet', 'fermi', 'workbench']);
    expect(patch.tools).toEqual(['execute_tool']);
    expect(patch.agentClass).toBe('fermi');
    expect(patch.platformAgentId).toBe('plat_1');
    expect(patch.runtimeSlug).toBe('bunker-watch-abc-runtime');
    expect(patch.config).toMatchObject({
      systemPrompt: INSTRUCTIONS,
      persona: 'Helps ops',
      agent_class: 'fermi',
      platformAgentId: 'plat_1',
      source: { workbenchSessionId: 'sess-1' },
    });
    expect(workbenchSessionIdFromConfig(patch.config)).toBe('sess-1');
  });

  it('keeps the catalog name when the draft name is cleared', () => {
    const state = applyUserEdit(draft({ name: 'Bunker Watch', readiness: 'commission' }), 'name', '   ');
    expect(catalogSyncFromState(state, catalog).name).toBe('Old name');
  });
});

describe('runtime prompt', () => {
  it('keeps the test-run wording and uses a live wording for saved agents', () => {
    const state = draft({ name: 'Bunker Watch', prompt: { instructions: INSTRUCTIONS, persona: 'Helps ops' } });
    const testPrompt = buildTestRunSystemPrompt(state);
    expect(testPrompt).toContain('being test-run before it is commissioned');
    expect(testPrompt).toContain('Purpose: Helps ops');
    expect(testPrompt).toContain(INSTRUCTIONS);

    const live = buildRuntimeSystemPrompt({
      name: 'Bunker Watch',
      persona: 'Helps ops',
      instructions: INSTRUCTIONS,
      datasources: [],
      mode: 'live',
    });
    expect(live).toContain('saved agent');
    expect(live).not.toContain('test-run');
    expect(live).toContain(INSTRUCTIONS);
  });

  it('reads a live brief only when the catalog has instructions', () => {
    expect(runtimeBriefFromCatalog({ name: 'A', config: { systemPrompt: 'too short' } })).toBeNull();
    const brief = runtimeBriefFromCatalog({
      name: 'Bunker Watch',
      config: {
        systemPrompt: INSTRUCTIONS,
        persona: 'Helps ops',
        datasources: [{ kind: 'databricks', ref: 'synergy_dwh.ops.bunker', scope: null }, { kind: 1 }],
      },
    });
    expect(brief).toMatchObject({
      name: 'Bunker Watch',
      persona: 'Helps ops',
      instructions: INSTRUCTIONS,
      datasources: [{ kind: 'databricks', ref: 'synergy_dwh.ops.bunker', scope: null }],
    });
  });
});
