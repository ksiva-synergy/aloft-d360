/**
 * Real runs: persisted steps, resume, idempotency, access, and the live executors' guard rails.
 * Prisma is a small in-memory store; the runner, validator and policy check are the real code.
 * Only the saved-agent runner is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import type { PolicyContext } from '@/lib/capabilities/types';

const { db, tables, writeAudit, runCatalogAgent } = vi.hoisted(() => {
  type Row = Record<string, any>;
  const tables = { flows: [] as Row[], versions: [] as Row[], runs: [] as Row[], steps: [] as Row[], users: [] as Row[], seq: 0 };
  const id = () => `00000000-0000-4000-8000-${String(++tables.seq).padStart(12, '0')}`;
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'not' in v ? row[k] !== v.not : row[k] === v));
  const db: any = {
    user: { findUnique: async ({ where }: any) => tables.users.find((u) => u.id === where.id) ?? null },
    platformFlow: { findUnique: async ({ where }: any) => tables.flows.find((f) => f.id === where.id) ?? null },
    platformFlowVersion: { findUnique: async ({ where }: any) => tables.versions.find((v) => v.id === where.id) ?? null },
    platformFlowRun: {
      create: async ({ data }: any) => {
        if (data.idempotency_key && tables.runs.some((r) => r.flow_id === data.flow_id && r.idempotency_key === data.idempotency_key)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: id(), status: 'queued', error: null, total_tokens: 0, cost_usd: 0, started_at: null, finished_at: null, created_at: new Date(), ...data };
        tables.runs.push(row);
        return row;
      },
      findFirst: async ({ where }: any) => tables.runs.find((r) => matches(r, where)) ?? null,
      findUnique: async ({ where, include }: any) => {
        const r = tables.runs.find((x) => x.id === where.id);
        return r ? (include?.steps ? { ...r, steps: tables.steps.filter((s) => s.run_id === r.id) } : r) : null;
      },
      findMany: async ({ where }: any) => tables.runs.filter((r) => matches(r, where)),
      update: async ({ where, data }: any) => Object.assign(tables.runs.find((r) => r.id === where.id)!, data),
      updateMany: async ({ where, data }: any) => {
        const rows = tables.runs.filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    platformFlowStepRun: {
      findMany: async ({ where }: any) => tables.steps.filter((s) => matches(s, where)),
      upsert: async ({ where, create, update }: any) => {
        const { run_id, step_id } = where.run_id_step_id;
        const row = tables.steps.find((s) => s.run_id === run_id && s.step_id === step_id);
        if (row) return Object.assign(row, update);
        const made = { id: id(), ...create };
        tables.steps.push(made);
        return made;
      },
    },
  };
  return { db, tables, writeAudit: vi.fn(async () => {}), runCatalogAgent: vi.fn() };
});

vi.mock('@/lib/db', () => ({ prisma: db, default: db }));
vi.mock('@/lib/audit', () => ({ writeAudit }));
vi.mock('@/lib/knowledge/service', () => ({ searchForUser: vi.fn(async () => []) }));
vi.mock('@/lib/agents/run-catalog-agent', () => {
  class AgentRunError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  }
  return { runCatalogAgent, AgentRunError };
});

import { decideApproval, getRun, listRuns, startRun } from '../runs';
import { createPrismaRunStore } from '../run-store';
import type { Actor } from '../service';

const actor = (userId: string, role = 'member'): Actor => ({ userId, role, orgId: 'org-1' });
const ALICE = actor('alice');
const policy: PolicyContext = { actorId: 'alice', tenantId: 'org-1', permissions: new Set(['inspector:use']), egress: { emailDomains: ['example.com'] } };
const status = async (p: Promise<unknown>) => (await p.then(() => 0, (e) => (e as ApiError).status)) as number;

const definition = (budget?: number) => ({
  name: 'Summarise',
  trigger: { type: 'manual' },
  inputs: [{ name: 'topic', type: 'string', description: 'Topic' }],
  ...(budget === undefined ? {} : { budget: { maxCostUsd: budget } }),
  steps: [
    { id: 'ask', type: 'agent', config: { agentSlug: 'analyst', prompt: 'Summarise {{inputs.topic}}' } },
    { id: 'save', type: 'output', dependsOn: ['ask'], config: { kind: 'save', title: 'Summary', content: '{{steps.ask.text}}' } },
  ],
});

function seedFlow(over: Record<string, any> = {}, def: unknown = definition()) {
  tables.flows.push({ id: 'flow-1', org_id: 'org-1', owner: 'alice', status: 'active', current_version_id: 'ver-1', name: 'Summarise', ...over });
  tables.versions.push({ id: 'ver-1', flow_id: 'flow-1', version: 1, definition: def });
}

const agentResult = (over: Record<string, any> = {}) => ({
  agent: { id: 'a1', name: 'Analyst', slug: 'analyst', status: 'live' },
  model: 'm',
  outcome: 'completed',
  text: 'All good',
  answer: null,
  usage: { inputTokens: 100, outputTokens: 20 },
  costUsd: 0.01,
  turnId: 't1',
  ...over,
});

beforeEach(() => {
  tables.flows = [];
  tables.versions = [];
  tables.runs = [];
  tables.steps = [];
  tables.users = [];
  writeAudit.mockClear();
  runCatalogAgent.mockReset();
  runCatalogAgent.mockResolvedValue(agentResult());
});

describe('startRun', () => {
  it('runs a published flow, saves every step, and records cost, tokens and audit', async () => {
    seedFlow();
    const run = await startRun(ALICE, policy, 'flow-1', { inputs: { topic: 'fuel' } });
    expect(run.status).toBe('succeeded');
    expect(run.totalTokens).toBe(120);
    expect(run.costUsd).toBeCloseTo(0.01);
    expect(runCatalogAgent).toHaveBeenCalledWith(expect.objectContaining({ slug: 'analyst', message: 'Summarise fuel', surface: 'automation' }));
    const detail = await getRun(ALICE, 'flow-1', run.id);
    expect(detail.steps.map((s) => [s.stepId, s.status])).toEqual([['ask', 'succeeded'], ['save', 'succeeded']]);
    expect(detail.steps.find((s) => s.stepId === 'save')!.output).toMatchObject({ saved: true, content: 'All good' });
    expect(writeAudit.mock.calls.map((c: any[]) => c[0].action)).toEqual(['flow.run.started', 'flow.run.finished']);
  });

  it('refuses a draft flow', async () => {
    seedFlow({ status: 'draft' });
    expect(await status(startRun(ALICE, policy, 'flow-1'))).toBe(409);
    expect(runCatalogAgent).not.toHaveBeenCalled();
  });

  it('hides other people’s flows (404) but lets a platform admin run them', async () => {
    seedFlow();
    expect(await status(startRun(actor('bob'), policy, 'flow-1'))).toBe(404);
    expect((await startRun(actor('root', 'platform_admin'), policy, 'flow-1', { inputs: { topic: 'x' } })).status).toBe('succeeded');
  });

  it('the same idempotency key starts one run, even when requests race', async () => {
    seedFlow();
    const [a, b] = await Promise.all([
      startRun(ALICE, policy, 'flow-1', { inputs: { topic: 'x' }, idempotencyKey: 'k1' }),
      startRun(ALICE, policy, 'flow-1', { inputs: { topic: 'x' }, idempotencyKey: 'k1' }),
    ]);
    const c = await startRun(ALICE, policy, 'flow-1', { inputs: { topic: 'x' }, idempotencyKey: 'k1' });
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(c.reused).toBe(true);
    expect(tables.runs).toHaveLength(1);
    expect(runCatalogAgent).toHaveBeenCalledTimes(1);
  });

  it('a failing step fails the run and skips the rest; the error is saved', async () => {
    seedFlow();
    runCatalogAgent.mockRejectedValue(new Error('model down'));
    const run = await startRun(ALICE, policy, 'flow-1', { inputs: { topic: 'x' } });
    expect(run.status).toBe('failed');
    expect(run.error).toContain('model down');
    const detail = await getRun(ALICE, 'flow-1', run.id);
    expect(detail.steps.find((s) => s.stepId === 'ask')).toMatchObject({ status: 'failed', error: 'model down' });
    expect(detail.steps.find((s) => s.stepId === 'save')).toMatchObject({ status: 'skipped' });
  });

  it('stops a step that would exceed the run budget', async () => {
    seedFlow({}, definition(0.005));
    // The static check passes with a zero estimate; the real cost ($0.01) then trips the live meter.
    const run = await startRun(ALICE, policy, 'flow-1', { inputs: { topic: 'x' }, estimateAgentCostUsd: () => 0 });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/budget/);
    expect(runCatalogAgent).toHaveBeenCalledTimes(1); // budget errors are not retried
  });

  it('an agent step with no saved agent fails clearly instead of pretending', async () => {
    seedFlow({}, { name: 'x', trigger: { type: 'manual' }, steps: [{ id: 'ask', type: 'agent', config: { prompt: 'hi' } }] });
    const run = await startRun(ALICE, policy, 'flow-1');
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/saved agent/);
  });

  it('pauses at an approval step', async () => {
    seedFlow({}, { name: 'x', trigger: { type: 'manual' }, steps: [{ id: 'ok', type: 'approval', config: { message: 'Go?' } }] });
    const run = await startRun(ALICE, policy, 'flow-1');
    expect(run.status).toBe('waiting_approval');
  });
});

describe('PrismaRunStore resume', () => {
  it('a restarted run skips steps that already succeeded', async () => {
    seedFlow();
    tables.runs.push({ id: 'run-9', flow_id: 'flow-1', status: 'running', error: null });
    const store = createPrismaRunStore('run-9');
    await store.saveStepRun({ stepId: 'ask', status: 'succeeded', attempt: 1, output: { text: 'earlier answer' } });
    const { executeRun } = await import('@/lib/flows/runner');
    const { validateFlow } = await import('@/lib/flows/validate');
    const v = validateFlow(definition());
    if (!v.ok) throw new Error('invalid');
    const calls = vi.fn(async () => ({ kind: 'done' as const, output: {} }));
    const result = await executeRun({
      flow: v.flow,
      order: v.order,
      inputs: { topic: 'x' },
      store,
      executors: { agent: calls, output: async (_s, r) => ({ kind: 'done', output: { content: (r.config as any).content } }) },
    });
    expect(result).toBe('succeeded');
    expect(calls).not.toHaveBeenCalled();
    expect(tables.steps.find((s) => s.step_id === 'save')!.output).toEqual({ content: 'earlier answer' });
  });

  it('a cancelled run is not revived by a later status write', async () => {
    tables.runs.push({ id: 'run-8', flow_id: 'flow-1', status: 'cancelled', error: null });
    const store = createPrismaRunStore('run-8');
    await store.setRunStatus('running');
    expect(tables.runs[0].status).toBe('cancelled');
    expect(await store.isCancelled()).toBe(true);
  });
});

describe('listRuns / getRun access', () => {
  it('only the owner or a platform admin can read run history; run ids from another flow are 404', async () => {
    seedFlow();
    const run = await startRun(ALICE, policy, 'flow-1', { inputs: { topic: 'x' } });
    expect(await listRuns(ALICE, 'flow-1')).toHaveLength(1);
    expect(await status(listRuns(actor('bob'), 'flow-1'))).toBe(404);
    expect(await status(getRun(actor('bob'), 'flow-1', run.id))).toBe(404);
    tables.flows.push({ id: 'flow-2', org_id: 'org-1', owner: 'alice', status: 'active', current_version_id: null, name: 'o' });
    expect(await status(getRun(ALICE, 'flow-2', run.id))).toBe(404);
  });
});

describe('approval step', () => {
  const gated = (assignee?: string) => ({
    name: 'Gated',
    trigger: { type: 'manual' },
    inputs: [{ name: 'topic', type: 'string', description: 'Topic' }],
    steps: [
      { id: 'ask', type: 'agent', config: { agentSlug: 'analyst', prompt: 'Summarise {{inputs.topic}}' } },
      { id: 'gate', type: 'approval', dependsOn: ['ask'], config: { message: 'Release it?', ...(assignee ? { assignee } : {}) } },
      { id: 'save', type: 'output', dependsOn: ['gate'], config: { kind: 'save', title: 'Summary', content: '{{steps.ask.text}}' } },
    ],
  });
  const start = async (assignee?: string) => {
    seedFlow({}, gated(assignee));
    const run = await startRun(ALICE, policy, 'flow-1', { inputs: { topic: 'x' } });
    expect(run.status).toBe('waiting_approval');
    return run;
  };
  const decide = (a: Actor, runId: string, decision: 'approve' | 'reject' = 'approve', comment?: string) =>
    decideApproval(a, policy, 'flow-1', runId, { stepId: 'gate', decision, comment, estimateAgentCostUsd: () => 0 });

  it('approve resumes after the gate without re-running earlier steps, and records who approved', async () => {
    const run = await start();
    const startedAt = tables.runs[0].started_at;
    const done = await decide(ALICE, run.id, 'approve', 'looks fine');
    expect(done.status).toBe('succeeded');
    expect(runCatalogAgent).toHaveBeenCalledTimes(1);
    expect(done.costUsd).toBeCloseTo(0.01); // cost is kept, not reset, across the pause
    expect(tables.runs[0].started_at).toBe(startedAt);
    const detail = await getRun(ALICE, 'flow-1', run.id);
    expect(detail.steps.find((s) => s.stepId === 'gate')!.output).toMatchObject({ approved: true, by: 'alice', comment: 'looks fine' });
    expect(detail.steps.find((s) => s.stepId === 'save')!.output).toMatchObject({ saved: true, content: 'All good' });
    expect(writeAudit.mock.calls.map((c: any[]) => c[0].action)).toContain('flow.approval.decided');
  });

  it('reject fails the run, skips what follows and never runs it', async () => {
    const run = await start();
    const done = await decide(ALICE, run.id, 'reject', 'not yet');
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/rejected/);
    const detail = await getRun(ALICE, 'flow-1', run.id);
    expect(detail.steps.find((s) => s.stepId === 'gate')).toMatchObject({ status: 'failed', error: 'Rejected: not yet' });
    expect(detail.steps.find((s) => s.stepId === 'save')).toMatchObject({ status: 'skipped' });
    expect(detail.steps.find((s) => s.stepId === 'ask')).toMatchObject({ status: 'succeeded' });
  });

  it('a decision is final: a second one, or two at once, is refused and the rest runs once', async () => {
    const run = await start();
    const results = await Promise.allSettled([decide(ALICE, run.id), decide(ALICE, run.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as ApiError).status).toBe(409);
    expect(tables.steps.filter((s) => s.step_id === 'save')).toHaveLength(1);
    expect(await status(decide(ALICE, run.id, 'reject'))).toBe(409);
  });

  it('losing the atomic claim (another decision got there first) is refused and nothing runs', async () => {
    const run = await start();
    const before = tables.steps.length;
    vi.spyOn(db.platformFlowRun, 'updateMany').mockResolvedValueOnce({ count: 0 });
    expect(await status(decide(ALICE, run.id))).toBe(409);
    expect(tables.steps).toHaveLength(before);
    expect(tables.runs[0].status).toBe('waiting_approval');
  });

  it('refuses a step that is not an approval waiting, and other flows’ runs', async () => {
    const run = await start();
    expect(await status(decideApproval(ALICE, policy, 'flow-1', run.id, { stepId: 'ask', decision: 'approve' }))).toBe(409);
    expect(await status(decideApproval(ALICE, policy, 'flow-1', 'missing', { stepId: 'gate', decision: 'approve' }))).toBe(404);
  });

  it('with an assignee, only that person (by email) or a platform admin may decide; the owner may look but not decide', async () => {
    tables.users.push({ id: 'bob', email: 'Boss@Example.com' }, { id: 'carol', email: 'carol@example.com' });
    const run = await start('boss@example.com');
    expect(await status(decide(ALICE, run.id))).toBe(403); // owner, not the assignee
    expect(await status(decide(actor('carol'), run.id))).toBe(404); // stranger learns nothing
    expect((await decide(actor('bob'), run.id)).status).toBe('succeeded');
  });

  it('without an assignee a stranger gets 404 and a platform admin may decide', async () => {
    const run = await start();
    expect(await status(decide(actor('carol'), run.id))).toBe(404);
    expect((await decide(actor('root', 'platform_admin'), run.id, 'reject')).status).toBe('failed');
  });
});
