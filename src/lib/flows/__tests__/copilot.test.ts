import { describe, expect, it } from 'vitest';
import { applyOperations, diffFlows, draftEdges, parseOperations, reduceEdges } from '../copilot';
import { validateFlow } from '../validate';
import { getFlowTemplate } from '../templates';
import type { Def } from '../edit';

const po = () => JSON.parse(JSON.stringify(getFlowTemplate('procurement-po-follow-up')!.definition)) as Def;

describe('copilot operations', () => {
  it('applies a multi-step proposal in order and the result still validates', () => {
    const parsed = parseOperations([
      { op: 'set_trigger', trigger: { type: 'schedule', cron: '0 6 * * 1' } },
      { op: 'add_step', step: { id: 'summary', type: 'agent', name: 'Summarise', dependsOn: ['email_supplier'], config: { prompt: 'Summarise {{steps.supplier.body.name}}' } } },
      { op: 'update_step', id: 'notify_team', dependsOn: ['summary'], config: { input: { channel: 'procurement', text: '{{steps.summary.text}}' } } },
      { op: 'set_budget', maxCostUsd: 0.2 },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const before = po();
    const r = applyOperations(before, parsed.operations);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes).toEqual(['Runs on the schedule 0 6 * * 1 (UTC)', 'Added step "Summarise" (Ask AI)', 'Changed step "Tell procurement"', 'Set the per-run budget to $0.2']);
    expect(validateFlow(r.definition).ok).toBe(true);
    // The draft passed in is never mutated.
    expect(before.trigger).toEqual({ type: 'webhook', name: 'purchase-order-updated' });
    expect(diffFlows(before, r.definition)).toEqual({ added: ['summary'], removed: [], changed: ['notify_team'], settings: true });
  });

  it('rejects the whole proposal when one change cannot apply', () => {
    const parsed = parseOperations([
      { op: 'set_name', name: 'Renamed' },
      { op: 'update_step', id: 'nope', name: 'x' },
    ]);
    if (!parsed.ok) throw new Error('should parse');
    const r = applyOperations(po(), parsed.operations);
    expect(r).toEqual({ ok: false, errors: ['change 2 (update_step): there is no step "nope"'] });
  });

  it('refuses malformed operations before applying anything', () => {
    const r = parseOperations([{ op: 'run_shell', cmd: 'rm -rf /' }, { op: 'add_step', step: { id: 'Bad Id', type: 'agent', config: {} } }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
    expect(parseOperations('not a list').ok).toBe(false);
  });

  it('removes config keys set to null, clears conditions, and renames references', () => {
    const parsed = parseOperations([
      { op: 'update_step', id: 'approve_follow_up', when: null, config: { assignee: null } },
      { op: 'rename_step', from: 'supplier', to: 'vendor' },
    ]);
    if (!parsed.ok) throw new Error('should parse');
    const r = applyOperations(po(), parsed.operations);
    if (!r.ok) throw new Error(r.errors.join());
    const approval = r.definition.steps!.find((s) => s.id === 'approve_follow_up')!;
    expect(approval.when).toBeUndefined();
    expect(approval.config.assignee).toBeUndefined();
    expect(approval.dependsOn).toEqual(['vendor']);
    expect(JSON.stringify(r.definition)).not.toContain('steps.supplier');
  });

  it('removing an approval leaves a definition the policy check will flag (the copilot cannot hide it)', () => {
    const parsed = parseOperations([{ op: 'remove_step', id: 'approve_follow_up' }]);
    if (!parsed.ok) throw new Error('should parse');
    const r = applyOperations(po(), parsed.operations);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.definition.steps!.find((s) => s.id === 'email_supplier')!.dependsOn).toEqual([]);
  });

  it('draws edges from dependsOn and from references, ignoring unknown steps', () => {
    const edges = draftEdges({ name: 'x', steps: [{ id: 'a', type: 'query', config: {} }, { id: 'b', type: 'agent', dependsOn: ['ghost'], config: { prompt: '{{steps.a.rows}}' } }] });
    expect(edges).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('draws a reference to an earlier step only when no longer path already connects them', () => {
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'c' },
      { from: 'a', to: 'd' },
    ];
    expect(reduceEdges(edges)).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'd' },
    ]);
  });
});
