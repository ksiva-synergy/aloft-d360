/**
 * "Search knowledge" steps in the flow core: a step must name the knowledge bases it searches, each
 * one the publisher may search and not archived (when the caller supplies the list), the ids cannot
 * come from run data, the step says in words what it searches, and a test run returns `chunks`.
 */
import { describe, expect, it } from 'vitest';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import type { PolicyContext } from '@/lib/capabilities/types';
import { analyzeFlow } from '../analyze';
import { checkFlowPolicy } from '../policy';
import { validateFlow } from '../validate';

const knowledgeBases = new Map([
  ['kb-sms', { name: 'Company SMS', archived: false }],
  ['kb-old', { name: 'Old circulars', archived: true }],
]);
const policy = (withKbs = true): PolicyContext => ({ actorId: 'u', tenantId: 'o', permissions: new Set(['inspector:use']), egress: { emailDomains: [] }, ...(withKbs ? { knowledgeBases } : {}) });
const flow = (config: Record<string, unknown>) => ({
  name: 'Answer from the SMS',
  inputs: [{ name: 'kb', type: 'string', required: false }],
  steps: [
    { id: 'find', type: 'retrieve', config: { query: 'emergency fire pump test interval', ...config } },
    { id: 'save', type: 'output', config: { kind: 'save', title: 'Passages', content: '{{steps.find.chunks}}' } },
  ],
});
const analyze = (raw: unknown, withKbs = true, simulate = false) => analyzeFlow(raw, { registry: builtinCapabilityRegistry, policy: policy(withKbs), simulate });
const findings = async (raw: unknown, withKbs = true) => {
  const a = await analyze(raw, withKbs);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  return a.findings.filter((f) => f.stepId === 'find');
};

describe('Search knowledge steps', () => {
  it('accepts knowledge bases the publisher may search and says which in words', async () => {
    expect(await findings(flow({ knowledgeBaseIds: ['kb-sms'] }))).toEqual([]);
    const v = validateFlow(flow({ knowledgeBaseIds: ['kb-sms'] }));
    if (!v.ok) throw new Error('invalid');
    expect(checkFlowPolicy(v.flow, { registry: builtinCapabilityRegistry, policy: policy() }).profiles.find!.does).toBe('Searches "Company SMS" for "emergency fire pump test interval"');
  });

  it('blocks publishing with no knowledge base, an unknown or archived one, or one taken from run data', async () => {
    expect((await findings(flow({}))).map((f) => f.code)).toEqual(['no_knowledge_base']);
    expect((await findings(flow({ knowledgeBaseIds: ['kb-bens-private'] }))).map((f) => f.message)).toEqual(['knowledge base "kb-bens-private" does not exist or is not shared with you']);
    expect((await findings(flow({ knowledgeBaseIds: ['kb-old'] }))).map((f) => f.message)).toEqual(['knowledge base "Old circulars" is archived, so nothing in it is searched']);
    expect((await findings(flow({ knowledgeBaseIds: ['{{inputs.kb}}'] }))).map((f) => f.code)).toEqual(['data_bound_control_field']);
    const a = await analyze(flow({}));
    expect(a.ok && a.readyToPublish).toBe(false);
  });

  it('skips the access check when the caller has no list, but still needs a choice', async () => {
    expect(await findings(flow({ knowledgeBaseIds: ['kb-anything'] }), false)).toEqual([]);
    expect((await findings(flow({}), false)).map((f) => f.code)).toEqual(['no_knowledge_base']);
  });

  it('returns chunks in a test run so later steps can use them', async () => {
    const a = await analyze(flow({ knowledgeBaseIds: ['kb-sms'] }), true, true);
    expect(a.ok && a.simulation?.steps.find((s) => s.stepId === 'find')).toMatchObject({ status: 'succeeded', mocked: true, output: { chunks: [] } });
  });
});
