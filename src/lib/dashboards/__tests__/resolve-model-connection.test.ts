import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #3 — bind-time guard: same model ⇒ same connection.
 *
 * DEC-1 keeps `platform_dashboards.connection_id` per-dashboard, so the schema
 * permits two dashboards on one model to point at different connections — a
 * reachable violation of the invariant that a model's numbers agree everywhere.
 * `resolveModelConnection` is the single application-layer choke point both
 * binding paths (create + save) call to enforce it. These tests exercise the
 * three branches of that contract with a mocked prisma + org.
 *
 * Runs as pure logic (mocked `@/lib/db` + `getDefaultOrg`), no live creds.
 */

const { findFirst, getDefaultOrg } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getDefaultOrg: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  default: { platform_dashboards: { findFirst } },
}));

vi.mock('@/lib/platform/agents', () => ({ getDefaultOrg }));

import {
  resolveModelConnection,
  DashboardModelConnectionConflictError,
} from '../connection';

const ORG_ID = 'org-1';
const MODEL_ID = 'model-abc';
const CONN_A = 'conn-A';
const CONN_B = 'conn-B';

beforeEach(() => {
  findFirst.mockReset();
  getDefaultOrg.mockReset();
  getDefaultOrg.mockResolvedValue({ id: ORG_ID });
});

describe('resolveModelConnection', () => {
  it('(a) inherits the existing dashboard\'s connection when the model is already bound', async () => {
    // An earlier dashboard already binds MODEL_ID to CONN_A.
    findFirst.mockResolvedValue({ connection_id: CONN_A });

    // Second dashboard supplies the SAME default (deterministic catalog) → inherit.
    const resolved = await resolveModelConnection(MODEL_ID, CONN_A);
    expect(resolved).toBe(CONN_A);

    // ...and even with no supplied value it inherits the canonical connection.
    const inheritedNoSupply = await resolveModelConnection(MODEL_ID);
    expect(inheritedNoSupply).toBe(CONN_A);

    // The lookup is org-scoped, model-scoped, soft-delete-aware, earliest-first.
    expect(findFirst).toHaveBeenCalledWith({
      where: { org_id: ORG_ID, model_id: MODEL_ID, deleted_at: null },
      orderBy: { created_at: 'asc' },
      select: { connection_id: true },
    });
  });

  it('(b) rejects a differing supplied connection with a typed error', async () => {
    // MODEL_ID is canonically bound to CONN_A...
    findFirst.mockResolvedValue({ connection_id: CONN_A });

    // ...binding a second dashboard on it to CONN_B is a genuine invariant
    // violation → typed reject, never a silent store.
    await expect(resolveModelConnection(MODEL_ID, CONN_B)).rejects.toBeInstanceOf(
      DashboardModelConnectionConflictError,
    );

    // The error carries the actionable ids for the caller / audit.
    await expect(resolveModelConnection(MODEL_ID, CONN_B)).rejects.toMatchObject({
      modelId: MODEL_ID,
      boundConnectionId: CONN_A,
      suppliedConnectionId: CONN_B,
    });
  });

  it('(c) first bind of an unbound model sets the supplied connection as canonical', async () => {
    // No dashboard binds MODEL_ID yet.
    findFirst.mockResolvedValue(null);

    const resolved = await resolveModelConnection(MODEL_ID, CONN_A);
    expect(resolved).toBe(CONN_A);
  });

  it('(c-guard) first bind with no supplied connection is a programming error', async () => {
    // Nothing to inherit and nothing supplied → loud throw (not a silent null).
    findFirst.mockResolvedValue(null);

    await expect(resolveModelConnection(MODEL_ID)).rejects.toThrow(
      /no connection was supplied/,
    );
  });
});
