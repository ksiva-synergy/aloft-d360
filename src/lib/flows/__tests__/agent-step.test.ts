/**
 * "Ask an agent" steps in the flow core: answer fields are checked while editing, a published flow
 * may only use a ready agent (when the caller supplies the agent list), and a test run returns the
 * same shape as a live run so later steps can use `values`.
 */
import { describe, expect, it } from 'vitest';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import type { PolicyContext } from '@/lib/capabilities/types';
import { analyzeFlow } from '../analyze';
import { pricingKey, computeCostUsd } from '@/lib/lifecycle/log-agent-cost';

const agents = new Map([
  ['regulatory-decision-tracer', { name: 'Regulatory Decision Tracer', status: 'live' }],
  ['invoice-harmonization-analyst', { name: 'Invoice Harmonization Analyst', status: 'draft' }],
  ['demand-signal-forecaster', { name: 'Demand Signal Forecaster', status: 'live', hasInstructions: false }],
]);
const policy = (withAgents = true): PolicyContext => ({ actorId: 'u', tenantId: 'o', permissions: new Set(['inspector:use']), egress: { emailDomains: [] }, ...(withAgents ? { agents } : {}) });
const flow = (config: Record<string, unknown>) => ({
  name: 'Rule check',
  budget: { maxCostUsd: 1 },
  steps: [
    { id: 'check', type: 'agent', config: { prompt: 'Is this compliant?', ...config } },
    { id: 'save', type: 'output', config: { kind: 'save', title: 'Result', content: 'Compliant: {{steps.check.values.compliant}}' } },
  ],
});
const answer = [{ key: 'compliant', label: 'Compliant', type: 'text', description: 'yes or no' }];
const analyze = (raw: unknown, withAgents = true, simulate = false) => analyzeFlow(raw, { registry: builtinCapabilityRegistry, policy: policy(withAgents), simulate });
const codes = async (raw: unknown, withAgents = true) => {
  const a = await analyze(raw, withAgents);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  return a.findings.filter((f) => f.stepId === 'check').map((f) => f.code);
};

describe('agent steps', () => {
  it('accepts a ready agent with good answer fields', async () => {
    expect(await codes(flow({ agentSlug: 'regulatory-decision-tracer', answer }))).toEqual([]);
  });

  it('flags an unknown agent, a draft agent and bad answer fields', async () => {
    expect(await codes(flow({ agentSlug: 'made-up' }))).toEqual(['unknown_agent']);
    const draft = await analyze(flow({ agentSlug: 'invoice-harmonization-analyst' }));
    expect(draft.ok && draft.findings).toContainEqual({
      severity: 'error',
      code: 'agent_not_ready',
      stepId: 'check',
      message: 'agent "Invoice Harmonization Analyst" is draft; publishing needs a live, staging or preview agent',
    });
    expect(draft.ok && draft.readyToPublish).toBe(false);
    expect(await codes(flow({ agentSlug: 'regulatory-decision-tracer', answer: [{ key: 'x', type: 'colour', description: 'y' }] }))).toEqual(['invalid_input']);
    // "live" in the catalog but only a placeholder: it cannot run at all.
    const placeholder = await analyze(flow({ agentSlug: 'demand-signal-forecaster' }));
    expect(placeholder.ok && placeholder.findings).toContainEqual(expect.objectContaining({ code: 'agent_not_ready', message: 'agent "Demand Signal Forecaster" has no instructions yet, so it cannot run' }));
  });

  it('skips the agent check when the caller has no agent list', async () => {
    expect(await codes(flow({ agentSlug: 'made-up' }), false)).toEqual([]);
  });

  it('returns the answer fields in a test run so later steps can use them', async () => {
    const a = await analyze(flow({ agentSlug: 'regulatory-decision-tracer', answer }), true, true);
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    expect(a.simulation!.status).toBe('succeeded');
    expect(a.simulation!.steps[0]!.output).toMatchObject({ values: { compliant: null }, missing: ['compliant'] });
    expect(a.simulation!.steps[1]!.output).toMatchObject({ content: 'Compliant: null' });
  });
});

describe('model prices', () => {
  it('prices Amazon Nova by its own list price, whatever the id looks like', () => {
    expect(pricingKey('bedrock/nova-pro')).toBe('nova-pro');
    expect(pricingKey('us.amazon.nova-pro-v1:0')).toBe('nova-pro');
    expect(pricingKey('us.anthropic.claude-sonnet-4-20250514-v1:0')).not.toBe('nova-pro');
    expect(computeCostUsd('bedrock/nova-pro', 1_000_000, 1_000_000)).toBeCloseTo(4.0, 6);
    expect(computeCostUsd('amazon.nova-lite-v1:0', 1_000_000, 0)).toBeCloseTo(0.06, 6);
  });
});
