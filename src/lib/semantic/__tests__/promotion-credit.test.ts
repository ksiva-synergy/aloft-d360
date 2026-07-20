/**
 * Gate 2 — reputation-credit guard (the "seam 3" weak-assertion trap).
 *
 * The promotion trust loop must credit the DRAFT AUTHOR, not the promoting
 * admin, and the credit must be a REAL positive reputation movement — not merely
 * "a row now exists". This file asserts both properties, the two the phase docs
 * called out by name (assert the delta AND the user, never existence):
 *
 *   A. selectAuthoringCreditRecipients — WHO gets credited: the row's created_by
 *      author, never the caller/approver; only actually-promoted rows; deduped.
 *   B. creditAuthoringPromotion — the credit is routed to that user in the
 *      semantic_authoring domain with the CONTRIBUTED outcome, and is a no-op
 *      when the reputation flag is off.
 *   C. DELTA (not existence): applying CONTRIBUTED raises the author's posterior
 *      mean above a pre-promote snapshot — a positive, non-zero credit.
 *   D. End-to-end recipient→credit: an admin promoting another user's candidate
 *      credits the AUTHOR exactly once and NEVER the admin.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// The reputation store is DB-backed; mock it so we can assert the exact credit
// call (org, user, domain, outcome) without a warehouse.
const applyOutcomeForUser = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/memory/reputation/store', () => ({
  applyOutcomeForUser: (...args: unknown[]) => applyOutcomeForUser(...args),
  getDomainReputation: vi.fn(),
}));

import {
  selectAuthoringCreditRecipients,
  creditAuthoringPromotion,
  REPUTATION_DOMAIN,
} from '../promotion-gate';
// Pure engine primitives for the delta assertion — no mock, real math.
import {
  newDomainReputation,
  applyOutcome,
  reputationMean,
  DEFAULT_CONFIG,
} from '@/lib/memory/reputation/engine';

const ORG = 'org1';
const AUTHOR = 'user-author';
const AUTHOR_2 = 'user-author-2';
const ADMIN = 'user-admin-promoter';

beforeEach(() => {
  applyOutcomeForUser.mockClear();
});

// ── A. Recipient selection — the author, never the caller ─────────────────────

describe('selectAuthoringCreditRecipients — credits the row author, not the promoter', () => {
  it('an admin promoting ANOTHER user\'s candidate credits the author, not the admin', () => {
    const targets = [{ id: 'def1', created_by: AUTHOR }];
    // The admin is the caller/approver; they authored nothing here.
    const recipients = selectAuthoringCreditRecipients(targets, ['def1']);
    expect(recipients).toEqual([AUTHOR]);
    expect(recipients).not.toContain(ADMIN);
  });

  it('credits ONLY authors of rows that actually promoted', () => {
    const targets = [
      { id: 'def1', created_by: AUTHOR },
      { id: 'def2', created_by: AUTHOR_2 }, // this one failed to promote
    ];
    const recipients = selectAuthoringCreditRecipients(targets, ['def1']); // only def1 succeeded
    expect(recipients).toEqual([AUTHOR]);
    expect(recipients).not.toContain(AUTHOR_2);
  });

  it('dedupes a multi-row promotion by one author to a single credit', () => {
    const targets = [
      { id: 'def1', created_by: AUTHOR },
      { id: 'def2', created_by: AUTHOR },
    ];
    const recipients = selectAuthoringCreditRecipients(targets, ['def1', 'def2']);
    expect(recipients).toEqual([AUTHOR]);
  });

  it('credits nobody for a row with no author (created_by null)', () => {
    const targets = [{ id: 'def1', created_by: null }];
    expect(selectAuthoringCreditRecipients(targets, ['def1'])).toEqual([]);
  });

  it('credits nobody when nothing promoted', () => {
    const targets = [{ id: 'def1', created_by: AUTHOR }];
    expect(selectAuthoringCreditRecipients(targets, [])).toEqual([]);
  });

  it('credits BOTH distinct authors of a mixed multi-author promotion', () => {
    const targets = [
      { id: 'def1', created_by: AUTHOR },
      { id: 'def2', created_by: AUTHOR_2 },
    ];
    const recipients = selectAuthoringCreditRecipients(targets, ['def1', 'def2']);
    expect(new Set(recipients)).toEqual(new Set([AUTHOR, AUTHOR_2]));
  });
});

// ── B. Credit routing — right user, right domain, right outcome; flag-gated ───

describe('creditAuthoringPromotion — routes the credit correctly and is flag-gated', () => {
  const original = process.env.MEMORY_REPUTATION_ENABLED;
  afterEach(() => { process.env.MEMORY_REPUTATION_ENABLED = original; });

  it('credits the given user in semantic_authoring with CONTRIBUTED when enabled', async () => {
    process.env.MEMORY_REPUTATION_ENABLED = 'true';
    await creditAuthoringPromotion(ORG, AUTHOR);
    expect(applyOutcomeForUser).toHaveBeenCalledTimes(1);
    expect(applyOutcomeForUser).toHaveBeenCalledWith(ORG, AUTHOR, REPUTATION_DOMAIN, 'CONTRIBUTED');
    expect(REPUTATION_DOMAIN).toBe('semantic_authoring');
  });

  it('is a no-op when the reputation flag is off', async () => {
    process.env.MEMORY_REPUTATION_ENABLED = 'false';
    await creditAuthoringPromotion(ORG, AUTHOR);
    expect(applyOutcomeForUser).not.toHaveBeenCalled();
  });
});

// ── C. DELTA, not existence — CONTRIBUTED is a real positive credit ───────────

describe('CONTRIBUTED is a positive reputation delta (not a no-op / not existence)', () => {
  it('raises the author\'s posterior mean above the pre-promote snapshot', () => {
    const T0 = 1_700_000_000_000; // fixed instant — deterministic, same-day (no decay)
    const cfg = DEFAULT_CONFIG;
    const rep = newDomainReputation(AUTHOR, REPUTATION_DOMAIN, 'member', T0);

    const before = reputationMean(rep, cfg, T0);              // pre-promote snapshot
    const credited = applyOutcome(rep, 'CONTRIBUTED', T0, cfg);
    const after = reputationMean(credited, cfg, T0);

    expect(after).toBeGreaterThan(before); // a genuine positive movement
    expect(credited.pos).toBeGreaterThan(rep.pos); // evidence actually banked
  });
});

// ── D. End-to-end: recipient selection → credit call, author not admin ────────

describe('promotion credit end-to-end — admin promotes author\'s candidate', () => {
  const original = process.env.MEMORY_REPUTATION_ENABLED;
  afterEach(() => { process.env.MEMORY_REPUTATION_ENABLED = original; });

  it('the AUTHOR is credited exactly once and the promoting ADMIN is never credited', async () => {
    process.env.MEMORY_REPUTATION_ENABLED = 'true';
    // Mirror the route: targets authored by AUTHOR, promoted by ADMIN (caller).
    const targets = [{ id: 'def1', created_by: AUTHOR }];
    const promotedIds = ['def1'];

    const recipients = selectAuthoringCreditRecipients(targets, promotedIds);
    for (const uid of recipients) await creditAuthoringPromotion(ORG, uid);

    // Credited the author, in the right domain/outcome…
    expect(applyOutcomeForUser).toHaveBeenCalledTimes(1);
    expect(applyOutcomeForUser).toHaveBeenCalledWith(ORG, AUTHOR, REPUTATION_DOMAIN, 'CONTRIBUTED');
    // …and NEVER the admin/promoter.
    const creditedUsers = applyOutcomeForUser.mock.calls.map((c) => c[1]);
    expect(creditedUsers).not.toContain(ADMIN);
  });
});
