import {
  decidePromotionEligibility,
  decideApprovalQuorum,
  SELF_APPROVE_STREETCRED_THRESHOLD,
  MIN_QUORUM_REPUTATION,
} from '../promotion-gate';

describe('decidePromotionEligibility', () => {
  it('lets an admin self-approve regardless of reputation (admin override)', () => {
    const e = decidePromotionEligibility({ isAdmin: true, score: 0, provisional: true });
    expect(e.canSelfApprove).toBe(true);
    expect(e.requiresApprovers).toBe(false);
    expect(e.reason).toMatch(/admin override/i);
  });

  it('blocks a provisional non-admin from self-approving (day-one state)', () => {
    const e = decidePromotionEligibility({ isAdmin: false, score: 0, provisional: true });
    expect(e.canSelfApprove).toBe(false);
    expect(e.requiresApprovers).toBe(true);
    expect(e.minApproverReputation).toBe(MIN_QUORUM_REPUTATION);
    expect(e.reason).toMatch(/provisional/i);
  });

  it('blocks a non-provisional non-admin below the self-approve threshold', () => {
    const e = decidePromotionEligibility({
      isAdmin: false,
      score: SELF_APPROVE_STREETCRED_THRESHOLD - 1,
      provisional: false,
    });
    expect(e.canSelfApprove).toBe(false);
    expect(e.requiresApprovers).toBe(true);
  });

  it('lets a high-reputation non-admin self-approve at/above the threshold', () => {
    const e = decidePromotionEligibility({
      isAdmin: false,
      score: SELF_APPROVE_STREETCRED_THRESHOLD,
      provisional: false,
    });
    expect(e.canSelfApprove).toBe(true);
    expect(e.requiresApprovers).toBe(false);
  });

  it('treats a provisional user as blocked even if their score is somehow high', () => {
    // provisional dominates — sparse evidence must never grant self-approve.
    const e = decidePromotionEligibility({ isAdmin: false, score: 99, provisional: true });
    expect(e.canSelfApprove).toBe(false);
  });
});

describe('decideApprovalQuorum', () => {
  it('is satisfied by any admin approver (admin override)', () => {
    const q = decideApprovalQuorum([{ isAdmin: true, score: 0 }]);
    expect(q.satisfied).toBe(true);
    expect(q.hasAdmin).toBe(true);
  });

  it('is not satisfied by sub-threshold non-admin approvers', () => {
    const q = decideApprovalQuorum([
      { isAdmin: false, score: 40 },
      { isAdmin: false, score: 50 },
    ]);
    expect(q.hasAdmin).toBe(false);
    expect(q.totalReputation).toBe(90);
    expect(q.satisfied).toBe(false);
  });

  it('is satisfied once summed non-admin reputation meets the minimum', () => {
    const q = decideApprovalQuorum([
      { isAdmin: false, score: 70 },
      { isAdmin: false, score: MIN_QUORUM_REPUTATION - 70 },
    ]);
    expect(q.totalReputation).toBe(MIN_QUORUM_REPUTATION);
    expect(q.satisfied).toBe(true);
  });

  it('is not satisfied by an empty approver set', () => {
    const q = decideApprovalQuorum([]);
    expect(q.satisfied).toBe(false);
    expect(q.totalReputation).toBe(0);
  });
});
