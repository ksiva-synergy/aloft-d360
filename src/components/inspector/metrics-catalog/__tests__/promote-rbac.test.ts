/**
 * RBAC acceptance: promote/archive must be DENIED IN THE API for non-admins —
 * not merely hidden in the UI (the catalog's core security invariant). We drive
 * the real promote route with the gate helpers mocked to the day-one reality
 * (everyone provisional, isAdmin=false) and assert 403 for both a non-owner and
 * an owner-without-reputation. The lens/emphasis gating in the UI is cosmetic on
 * top of this; this test is the thing that actually protects governance.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, getServerSession, getUserByEmail, getDefaultOrg, isAdmin, evaluatePromotionEligibility, promoteDefinitions } = vi.hoisted(() => ({
  db: {
    platform_semantic_models: { findFirst: vi.fn() },
    platform_sem_measures: { findMany: vi.fn() },
    platform_sem_dimensions: { findMany: vi.fn() },
    platform_sem_entities: { findMany: vi.fn() },
  },
  getServerSession: vi.fn(),
  getUserByEmail: vi.fn(),
  getDefaultOrg: vi.fn(),
  isAdmin: vi.fn(),
  evaluatePromotionEligibility: vi.fn(),
  promoteDefinitions: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ default: db }));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/platform/agents', () => ({ getDefaultOrg }));
vi.mock('@/lib/dashboards/permissions', () => ({ getUserByEmail }));
vi.mock('@/lib/semantic/promotion-gate', () => ({
  isAdmin,
  evaluatePromotionEligibility,
  creditAuthoringPromotion: vi.fn(),
  selectAuthoringCreditRecipients: vi.fn(() => []),
}));
vi.mock('@/lib/semantic/governance', () => ({
  promoteDefinitions,
  promoteEntities: vi.fn(),
}));

import { POST as promotePOST } from '../../../../app/api/inspector/semantic/[modelId]/promote/route';

const ORG = 'org-1';
const ME = 'u-me';

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof promotePOST>[0];
}
const ctx = { params: Promise.resolve({ modelId: 'model-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { email: 'me@example.com' } });
  getUserByEmail.mockResolvedValue({ id: ME, email: 'me@example.com' });
  getDefaultOrg.mockResolvedValue({ id: ORG });
  db.platform_semantic_models.findFirst.mockResolvedValue({ id: 'model-1', org_id: ORG, status: 'governed' });
  isAdmin.mockResolvedValue(false); // day-one reality
  evaluatePromotionEligibility.mockResolvedValue({ canSelfApprove: false, requiresApprovers: true, minApproverReputation: 120, reason: 'provisional' });
});

describe('promote route — non-admin denial', () => {
  it('403s a non-admin promoting someone else\'s candidate', async () => {
    db.platform_sem_measures.findMany.mockResolvedValue([{ id: 'm1', status: 'candidate', created_by: 'someone-else' }]);
    const res = await promotePOST(req({ definitionIds: ['m1'], tableKind: 'measure' }), ctx);
    expect(res.status).toBe(403);
    expect(promoteDefinitions).not.toHaveBeenCalled();
  });

  it('403s a non-admin owner who lacks self-approve reputation', async () => {
    db.platform_sem_measures.findMany.mockResolvedValue([{ id: 'm1', status: 'candidate', created_by: ME }]);
    const res = await promotePOST(req({ definitionIds: ['m1'], tableKind: 'measure' }), ctx);
    expect(res.status).toBe(403);
    expect(promoteDefinitions).not.toHaveBeenCalled();
  });

  it('allows an admin (override) to promote', async () => {
    isAdmin.mockResolvedValue(true);
    db.platform_sem_measures.findMany.mockResolvedValue([{ id: 'm1', status: 'candidate', created_by: 'someone-else' }]);
    promoteDefinitions.mockResolvedValue({ succeeded: ['m1'], errors: [] });
    const res = await promotePOST(req({ definitionIds: ['m1'], tableKind: 'measure' }), ctx);
    expect(res.status).toBe(200);
    expect(promoteDefinitions).toHaveBeenCalled();
  });
});
