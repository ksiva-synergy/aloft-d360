import { describe, expect, it } from 'vitest';
import { validateFlow } from '@/lib/flows/validate';
import { FLOW_TEMPLATES } from '@/lib/flows/templates';
import { addStep, coerceDefault, moveStep, removeStep, renameStep, setBudget, setTrigger, setWhen, updateStepConfig, type Def } from '../editor-model';

const tpl = (id: string) => JSON.parse(JSON.stringify(FLOW_TEMPLATES.find((t) => t.id === id)!.definition)) as Def;

describe('flow editor model', () => {
  it('addStep gives a unique id, chains after the last step, and a valid-shape default for every type', () => {
    let d: Def = { name: 'x', steps: [] };
    for (const type of ['approval', 'output', 'approval']) d = addStep(d, type);
    expect(d.steps!.map((s) => s.id)).toEqual(['approval_1', 'output_1', 'approval_2']);
    expect(d.steps![1]!.dependsOn).toEqual(['approval_1']);
    d = { name: 'x', steps: [{ id: 'a', type: 'transform', config: { op: 'count', input: '[]' } }] };
    d = addStep(d, 'agent');
    d = updateStepConfig(d, 'agent_1', { prompt: 'Summarise' });
    expect(validateFlow(d).ok).toBe(true);
  });

  it('removeStep drops dependsOn references; moveStep swaps neighbours and ignores edges', () => {
    const d = tpl('hr-new-starter-onboarding');
    const r = removeStep(d, 'create_account');
    expect(r.steps!.some((s) => s.dependsOn?.includes('create_account'))).toBe(false);
    const m = moveStep(d, 'create_account', -1);
    expect(m.steps![0]!.id).toBe('create_account');
    expect(moveStep(d, d.steps![0]!.id, -1)).toBe(d);
  });

  it('renameStep updates dependsOn and refs in text, and the renamed flow still validates', () => {
    const d = tpl('procurement-po-follow-up');
    const r = renameStep(d, 'supplier', 'vendor');
    const json = JSON.stringify(r);
    expect(json).not.toContain('steps.supplier');
    expect(json).toContain('{{steps.vendor.body.name}}');
    expect(r.steps![1]!.dependsOn).toEqual(['vendor']);
    expect(validateFlow(r).ok).toBe(true);
    // A longer id that merely starts with the old one is untouched.
    const d2: Def = { name: 'x', steps: [{ id: 'a', type: 'approval', config: { message: 'm' } }, { id: 'ab', type: 'approval', config: { message: '{{steps.ab.x}} {{steps.a.y}}' } }] };
    expect(JSON.stringify(renameStep(d2, 'a', 'z'))).toContain('{{steps.ab.x}} {{steps.z.y}}');
  });

  it('setTrigger, setBudget and setWhen produce valid configuration', () => {
    let d = tpl('finance-budget-variance');
    d = setTrigger(d, 'schedule', '0 6 * * 1');
    d = setBudget(d, 0.2);
    d = setWhen(d, 'save', { ref: '{{steps.over_budget.rowCount}}', operator: 'gt', value: 0 });
    expect(validateFlow(d).ok).toBe(true);
    expect(d.trigger).toEqual({ type: 'schedule', cron: '0 6 * * 1' });
    expect(setBudget(d, undefined).budget).toBeUndefined();
    expect(setTrigger(d, 'manual').trigger).toEqual({ type: 'manual' });
    expect(setWhen(d, 'save', undefined).steps!.find((s) => s.id === 'save')!.when).toBeUndefined();
  });

  it('edits never mutate the input definition', () => {
    const d = tpl('integration-order-webhook');
    const before = JSON.stringify(d);
    addStep(d, 'agent'); removeStep(d, 'alert'); renameStep(d, 'alert', 'notify'); setBudget(d, 1); setTrigger(d, 'manual');
    expect(JSON.stringify(d)).toBe(before);
  });

  it('coerceDefault follows the declared input type', () => {
    expect(coerceDefault('number', '20')).toBe(20);
    expect(coerceDefault('number', 'abc')).toBeUndefined();
    expect(coerceDefault('boolean', 'true')).toBe(true);
    expect(coerceDefault('string', '')).toBeUndefined();
  });
});
