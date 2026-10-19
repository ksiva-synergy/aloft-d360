import { describe, expect, it } from 'vitest';
import { constructionStateSchema, type ConstructionState } from '../constructionState';
import { applyUserEdit, mergeUserEdits, parseEditValue, userLockFor } from '../user-edits';
import { executeBuilderTool } from '../builder-tools';
import { applyAssumption } from '../apply-patch';
import { detectAgentBuildIntent } from '../handoff';
import { buildFlowNodes } from '@/components/workbench/config/FlowStrip';

const INSTRUCTIONS = 'Answer bunker variance questions for the fleet using the weekly bunker report.';

function draft(overrides: Record<string, unknown> = {}): ConstructionState {
  return constructionStateSchema.parse({ memory: { buildContext: { orgId: 'org-1' } }, ...overrides });
}

async function runTool(state: ConstructionState, tool: string, input: Record<string, unknown>) {
  let current = state;
  const out = await executeBuilderTool(tool, input, {
    getState: () => current,
    setState: (next) => { current = next; },
    emit: () => {},
  });
  return { result: JSON.parse(out) as Record<string, unknown>, state: current };
}

describe('applyUserEdit', () => {
  it('sets the value, marks provenance user and derives readiness', () => {
    let s = applyUserEdit(draft(), 'name', 'Bunker Watch');
    s = applyUserEdit(s, 'prompt.instructions', INSTRUCTIONS);
    s = applyUserEdit(s, 'class.id', 'fermi');
    expect(s.name).toBe('Bunker Watch');
    expect(s.class).toMatchObject({ id: 'fermi', source: 'chosen', confidence: 1 });
    expect(s.provenance).toMatchObject({ name: 'user', 'prompt.instructions': 'user', 'class.id': 'user' });
    expect(s.readiness).toBe('validate');
  });

  it('corrects a matching assumption, or confirms it when asked', () => {
    const base = applyAssumption(draft(), { field: 'prompt.persona', value: 'Ops lead', confidence: 0.6, rationale: 'guess' });
    expect(applyUserEdit(base, 'prompt.persona', 'Fleet manager').assumptionLedger[0]).toMatchObject({
      value: 'Fleet manager',
      status: 'corrected',
    });
    expect(applyUserEdit(base, 'prompt.persona', 'Ops lead', 'confirmed').assumptionLedger[0].status).toBe('confirmed');
  });

  it('keeps a commissioned draft at commission', () => {
    const s = applyUserEdit(draft({ readiness: 'commission' }), 'name', 'X');
    expect(s.readiness).toBe('commission');
  });
});

describe('parseEditValue', () => {
  it('trims text and turns empty optional text into null', () => {
    expect(parseEditValue('name', '  Bunker Watch ')).toEqual({ ok: true, value: 'Bunker Watch' });
    expect(parseEditValue('prompt.persona', '   ')).toEqual({ ok: true, value: null });
  });

  it('rejects bad class ids and malformed datasources', () => {
    expect(parseEditValue('class.id', 'Not A Slug!').ok).toBe(false);
    expect(parseEditValue('tools.datasources', [{ kind: 'warehouse', ref: 'a.b.c' }]).ok).toBe(false);
  });

  it('dedupes datasources by kind + ref', () => {
    const parsed = parseEditValue('tools.datasources', [
      { kind: 'databricks', ref: 'a.b.c' },
      { kind: 'databricks', ref: 'a.b.c' },
    ]);
    expect(parsed.ok && (parsed.value as unknown[]).length).toBe(1);
  });
});

describe('builder tools respect user-owned fields', () => {
  it('refuses an AI overwrite of a user-edited field', async () => {
    const s = applyUserEdit(draft(), 'name', 'Bunker Watch');
    const { result, state } = await runTool(s, 'update_agent_draft', { field: 'name', value: 'Something else' });
    expect(result).toMatchObject({ ok: false, error: 'USER_LOCKED' });
    expect(state.name).toBe('Bunker Watch');
  });

  it('locks a parent write too (class object over class.id)', async () => {
    const s = applyUserEdit(draft(), 'class.id', 'fermi');
    const { result } = await runTool(s, 'update_agent_draft', { field: 'class', value: { id: 'feynman' } });
    expect(result.error).toBe('USER_LOCKED');
  });

  it('allows the change when the model relays an explicit user request', async () => {
    const s = applyUserEdit(draft(), 'name', 'Bunker Watch');
    const { result, state } = await runTool(s, 'update_agent_draft', { field: 'name', value: 'Bunker Sentinel', source: 'user' });
    expect(result.ok).toBe(true);
    expect(state.name).toBe('Bunker Sentinel');
  });

  it('refuses add_datasource once the user owns the list', async () => {
    const s = applyUserEdit(draft(), 'tools.datasources', []);
    const { result, state } = await runTool(s, 'add_datasource', { kind: 'databricks', ref: 'a.b.c' });
    expect(result.error).toBe('USER_LOCKED');
    expect(state.tools.datasources).toEqual([]);
  });

  it('does not lock on confirmed free-form assumption keys', () => {
    const s = draft({ provenance: { targetUsers: 'user' } });
    expect(userLockFor(s, 'targetUsers')).toBeNull();
  });

  it('leaves Inspector-seeded datasources open to the builder', async () => {
    const s = draft({
      tools: { datasources: [{ kind: 'databricks', ref: 'a.b.c' }] },
      provenance: { 'tools.datasources': 'template' },
    });
    const { result, state } = await runTool(s, 'add_datasource', { kind: 'databricks', ref: 'a.b.d' });
    expect(result.ok).toBe(true);
    expect(state.tools.datasources).toHaveLength(2);
  });
});

describe('mergeUserEdits', () => {
  it('keeps a Config-panel edit made while the turn was streaming', () => {
    const start = draft({ name: 'Old' });
    const turn = { ...start, name: 'AI rename', provenance: { name: 'ai' as const } };
    const db = applyUserEdit(start, 'name', 'User rename');
    expect(mergeUserEdits(turn, db).name).toBe('User rename');
  });

  it('keeps the turn value when the turn itself wrote it as user', () => {
    const db = applyUserEdit(draft(), 'name', 'Panel name');
    const turn = { ...db, name: 'Chat-requested name', provenance: { name: 'user' as const } };
    expect(mergeUserEdits(turn, db).name).toBe('Chat-requested name');
  });

  it('keeps test runs and commission written by other routes', () => {
    const testRun = { question: 'q', at: '2026-10-19T00:00:00.000Z', outcome: 'completed' as const, toolCalls: 2, toolErrors: 0, answerPreview: 'a' };
    const db = draft({ readiness: 'commission', validation: { lastTestRun: testRun } });
    const merged = mergeUserEdits(draft({ name: 'X' }), db);
    expect(merged.validation.lastTestRun).toEqual(testRun);
    expect(merged.readiness).toBe('commission');
  });
});

describe('detectAgentBuildIntent', () => {
  it.each([
    'I would like to creat agent',
    'Can you build an agent for bunker variance?',
    'help me set up a compliance agent',
    'turn this into an agent',
  ])('detects "%s"', (text) => {
    expect(detectAgentBuildIntent(text)).toBe(true);
  });

  it.each([
    'Show weekly bunker columns',
    'Which agent ran this query?',
    'agent names in the new crew table',
  ])('ignores "%s"', (text) => {
    expect(detectAgentBuildIntent(text)).toBe(false);
  });
});

describe('buildFlowNodes', () => {
  it('reflects the draft', () => {
    const s = draft({
      class: { id: 'feynman' },
      prompt: { instructions: INSTRUCTIONS },
      tools: { datasources: [{ kind: 'databricks', ref: 'a.b.c' }] },
    });
    const byKey = Object.fromEntries(buildFlowNodes(s).map((n) => [n.key, n]));
    expect(byKey.data).toMatchObject({ status: 'done', detail: '1 table' });
    expect(byKey.reason).toMatchObject({ status: 'done', detail: 'Feynman' });
    expect(byKey.answer).toMatchObject({ status: 'empty', detail: 'Not tested' });
  });
});
