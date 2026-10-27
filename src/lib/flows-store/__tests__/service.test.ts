/**
 * Flow persistence: ownership, immutable versions, optimistic concurrency, and the server-side
 * publish gate. Prisma is replaced by a small in-memory store that honours the where/orderBy the
 * service uses; the flow core, policy checks and simulation are the real code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOW_TEMPLATES } from '@/lib/flows/templates';
import { ApiError } from '@/lib/http';
import type { PolicyContext } from '@/lib/capabilities/types';

const { db, tables, writeAudit } = vi.hoisted(() => {
  type Row = Record<string, any>;
  const tables = { flows: [] as Row[], versions: [] as Row[], runs: [] as Row[], seq: 0 };
  const id = () => `00000000-0000-4000-8000-${String(++tables.seq).padStart(12, '0')}`;
  const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  const db: any = {
    platformFlow: {
      findUnique: async ({ where }: any) => tables.flows.find((f) => f.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        tables.flows.filter((f) => matches(f, where)).map((f) => ({ ...f, versions: tables.versions.filter((v) => v.flow_id === f.id).sort((a, b) => b.version - a.version).slice(0, 1) })),
      create: async ({ data }: any) => {
        const row = { id: id(), status: 'draft', current_version_id: null, created_at: new Date(), updated_at: new Date(), ...data };
        tables.flows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(tables.flows.find((f) => f.id === where.id)!, data, { updated_at: new Date() }),
      delete: async ({ where }: any) => void (tables.flows = tables.flows.filter((f) => f.id !== where.id)),
    },
    platformFlowVersion: {
      findMany: async ({ where }: any) => tables.versions.filter((v) => matches(v, where)).sort((a, b) => b.version - a.version),
      findFirst: async ({ where }: any) => tables.versions.filter((v) => matches(v, where)).sort((a, b) => b.version - a.version)[0] ?? null,
      findUnique: async ({ where }: any) => tables.versions.find((v) => v.id === where.id) ?? null,
      create: async ({ data }: any) => {
        if (tables.versions.some((v) => v.flow_id === data.flow_id && v.version === data.version)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { id: id(), created_at: new Date(), ...data };
        tables.versions.push(row);
        return row;
      },
    },
    platformFlowRun: { count: async ({ where }: any) => tables.runs.filter((r) => matches(r, where)).length },
    $transaction: async (cb: any) => cb(db),
  };
  return { db, tables, writeAudit: vi.fn(async () => {}) };
});

vi.mock('@/lib/db', () => ({ prisma: db, default: db }));
vi.mock('@/lib/audit', () => ({ writeAudit }));

import { createFlow, deleteFlow, getFlow, listFlows, publishFlow, saveVersion, unpublishFlow, type Actor } from '../service';

const tpl = (id: string) => FLOW_TEMPLATES.find((t) => t.id === id)!;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const actor = (userId: string, role = 'member'): Actor => ({ userId, role, orgId: 'org-1' });
const policy = (perms: string[]): PolicyContext => ({ actorId: 'x', tenantId: 'org-1', permissions: new Set(perms), egress: { emailDomains: ['example.com'] } });
const ALL = ['inspector:use', 'connector:write', 'connector:external', 'flow:sql'];
const status = async (p: Promise<unknown>) => ((await p.then(() => 0, (e) => (e as ApiError).status)) as number);

const ALICE = actor('alice');
const BOB = actor('bob');
const ADMIN = actor('root', 'platform_admin');
const PO = tpl('procurement-po-follow-up');

beforeEach(() => {
  tables.flows = [];
  tables.versions = [];
  tables.runs = [];
  vi.clearAllMocks();
});

describe('flow persistence', () => {
  it('creates a draft owned by the caller at version 1, and rejects an invalid definition', async () => {
    const f = await createFlow(ALICE, PO.definition);
    expect(f).toMatchObject({ owner: 'alice', status: 'draft', version: 1, name: PO.name });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'flow.created', actorId: 'alice' }));
    expect(await status(createFlow(ALICE, { name: 'x', steps: [] }))).toBe(422);
    expect(tables.flows).toHaveLength(1);
  });

  it('shows a flow only to its creator and to platform admins', async () => {
    const f = await createFlow(ALICE, PO.definition);
    expect((await listFlows(ALICE)).map((x) => x.id)).toEqual([f.id]);
    expect(await listFlows(BOB)).toEqual([]);
    expect((await listFlows(ADMIN)).map((x) => x.id)).toEqual([f.id]);
    expect(await status(getFlow(BOB, f.id))).toBe(404); // same answer as "does not exist"
    expect((await getFlow(ALICE, f.id)).definition).toMatchObject({ name: PO.name });
    expect((await getFlow(ADMIN, f.id)).versions).toHaveLength(1);
    expect(await status(getFlow({ ...ALICE, orgId: 'org-2' }, f.id))).toBe(404);
    expect(await status(saveVersion(BOB, f.id, PO.definition, 1))).toBe(404);
    expect(await status(deleteFlow(BOB, f.id))).toBe(404);
  });

  it('saves immutable versions, rejects a stale base version, and keeps old versions intact', async () => {
    const f = await createFlow(ALICE, PO.definition);
    const edited = clone(PO.definition) as { name: string };
    edited.name = 'Renamed follow-up';
    const v2 = await saveVersion(ALICE, f.id, edited, 1);
    expect(v2).toMatchObject({ version: 2, name: 'Renamed follow-up', status: 'draft' });
    expect(await status(saveVersion(ALICE, f.id, edited, 1))).toBe(409); // stale
    expect(tables.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(tables.versions[0]!.definition.name).toBe(PO.name); // v1 untouched
    expect(await status(saveVersion(ALICE, f.id, { name: 'x', steps: [] }, 2))).toBe(422);
    expect((await getFlow(ALICE, f.id)).definition).toMatchObject({ name: 'Renamed follow-up' });
  });
});

describe('publish gate (server side)', () => {
  const body = { version: 1, inputs: PO.sampleInputs, fixtures: PO.fixtures };

  it('blocks a member who lacks the send/write permissions, and names them', async () => {
    const f = await createFlow(ALICE, PO.definition);
    const err = await publishFlow(ALICE, policy(['inspector:use']), f.id, body).catch((e) => e as ApiError);
    expect((err as ApiError).status).toBe(422);
    expect(JSON.stringify((err as ApiError).details)).toContain('connector:external');
    expect(tables.flows[0]!.status).toBe('draft');
  });

  it('publishes for a user who holds the permissions, then returns to draft on edit', async () => {
    const f = await createFlow(ADMIN, PO.definition);
    const pub = await publishFlow(ADMIN, policy(ALL), f.id, body);
    expect(pub).toMatchObject({ status: 'active', version: 1 });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'flow.published' }));
    const v2 = await saveVersion(ADMIN, f.id, PO.definition, 1);
    expect(v2.status).toBe('draft'); // the published version must be what was checked
    expect((await unpublishFlow(ADMIN, f.id)).status).toBe('draft');
  });

  it('refuses when the simulation does not succeed, even though the definition is valid', async () => {
    const f = await createFlow(ADMIN, PO.definition);
    // No sample response for the supplier lookup, so later references cannot resolve.
    const err = (await publishFlow(ADMIN, policy(ALL), f.id, { version: 1, inputs: PO.sampleInputs, fixtures: {} }).catch((e) => e)) as ApiError;
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/simulated run did not succeed/);
    expect(tables.flows[0]!.status).toBe('draft');
  });

  it('only publishes the latest saved version', async () => {
    const f = await createFlow(ADMIN, PO.definition);
    await saveVersion(ADMIN, f.id, PO.definition, 1);
    expect(await status(publishFlow(ADMIN, policy(ALL), f.id, body))).toBe(409);
    expect(await status(publishFlow(BOB, policy(ALL), f.id, { ...body, version: 2 }))).toBe(404);
  });
});

describe('delete', () => {
  it('deletes an unused flow and refuses one with run history', async () => {
    const a = await createFlow(ALICE, PO.definition);
    await deleteFlow(ALICE, a.id);
    expect(tables.flows).toHaveLength(0);
    const b = await createFlow(ALICE, PO.definition);
    tables.runs.push({ flow_id: b.id });
    expect(await status(deleteFlow(ALICE, b.id))).toBe(409);
  });
});
