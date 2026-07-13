import {
  ROLE_PRIORS,
  DEFAULT_CONFIG,
  newDomainReputation,
  applyOutcome,
  reputationMean,
  streetCred,
  repMultiplier,
  aggregateContributorReputation,
  DomainReputation,
} from './engine';

const DAY = 86_400_000;
let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}
function approx(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

const t0 = Date.parse('2026-01-01T00:00:00Z');

// 1. Cold start: a brand-new user sits exactly at their role prior.
{
  const senior = newDomainReputation('u_sen', 'billing', 'senior', t0);
  const member = newDomainReputation('u_mem', 'billing', 'member', t0);
  const ext = newDomainReputation('u_ext', 'billing', 'external', t0);
  check('cold-start senior == prior mean', approx(reputationMean(senior, DEFAULT_CONFIG, t0), ROLE_PRIORS.senior.mean));
  check('cold-start member == prior mean', approx(reputationMean(member, DEFAULT_CONFIG, t0), ROLE_PRIORS.member.mean));
  check('role ordering senior > member > external at cold start',
    reputationMean(senior, DEFAULT_CONFIG, t0) > reputationMean(member, DEFAULT_CONFIG, t0) &&
    reputationMean(member, DEFAULT_CONFIG, t0) > reputationMean(ext, DEFAULT_CONFIG, t0));
  const sc = streetCred(member, DEFAULT_CONFIG, t0);
  check('new user is flagged provisional', sc.provisional === true, `score=${sc.score}`);
}

// 2. Earned evidence moves the score and eventually dominates the prior.
{
  let rep = newDomainReputation('u1', 'billing', 'member', t0);
  const start = reputationMean(rep, DEFAULT_CONFIG, t0);
  // 30 helpful outcomes spread one per day (avoids the daily cap entirely).
  for (let i = 0; i < 30; i++) rep = applyOutcome(rep, 'HELPFUL', t0 + i * DAY);
  const after = reputationMean(rep, DEFAULT_CONFIG, t0 + 30 * DAY);
  check('sustained helpful raises reputation', after > start + 0.2, `${start.toFixed(3)} -> ${after.toFixed(3)}`);
  check('reputation stays in (0,1)', after > 0 && after < 1);
  check('user no longer provisional', streetCred(rep, DEFAULT_CONFIG, t0 + 30 * DAY).provisional === false);
}

// 3. Harm is penalised harder than help is rewarded (asymmetry).
{
  let up = newDomainReputation('up', 'auth', 'member', t0);
  let down = newDomainReputation('down', 'auth', 'member', t0);
  up = applyOutcome(up, 'HELPFUL', t0 + DAY);
  down = applyOutcome(down, 'HARMFUL', t0 + DAY);
  const upDelta = reputationMean(up, DEFAULT_CONFIG, t0 + DAY) - ROLE_PRIORS.member.mean;
  const downDelta = ROLE_PRIORS.member.mean - reputationMean(down, DEFAULT_CONFIG, t0 + DAY);
  check('one HARMFUL drops more than one HELPFUL raises', downDelta > upDelta,
    `+help=${upDelta.toFixed(4)} -harm=${downDelta.toFixed(4)}`);
}

// 4. Daily positive cap blunts grinding within a single day.
{
  let grind = newDomainReputation('g', 'billing', 'member', t0);
  // 100 helpful (+1.0 each) in ONE day; cap is 20 => only 20 should bank.
  for (let i = 0; i < 100; i++) grind = applyOutcome(grind, 'HELPFUL', t0);
  check('daily cap limits banked positive to cap', approx(grind.pos, DEFAULT_CONFIG.dailyPositiveCap),
    `pos=${grind.pos}`);
  // Harm is never capped.
  let harmed = newDomainReputation('h', 'billing', 'member', t0);
  for (let i = 0; i < 5; i++) harmed = applyOutcome(harmed, 'HARMFUL', t0);
  check('harm is not capped', approx(harmed.neg, 5 * 1.5), `neg=${harmed.neg}`);
}

// 5. Time decay erodes idle reputation toward the prior.
{
  let rep = newDomainReputation('d', 'billing', 'member', t0);
  for (let i = 0; i < 10; i++) rep = applyOutcome(rep, 'HELPFUL', t0 + i * DAY);
  const peak = reputationMean(rep, DEFAULT_CONFIG, t0 + 10 * DAY);
  const oneHalfLifeLater = reputationMean(rep, DEFAULT_CONFIG, t0 + (10 + 120) * DAY);
  check('idle reputation decays back toward prior', oneHalfLifeLater < peak,
    `peak=${peak.toFixed(3)} later=${oneHalfLifeLater.toFixed(3)}`);
  check('evidence roughly halves after one half-life', approx(rep.pos * 0.5, decayedPos(rep), 1e-6));
  function decayedPos(r: DomainReputation) {
    return r.pos * Math.pow(0.5, 120 / DEFAULT_CONFIG.halfLifeDays);
  }
}

// 6. Multiplier is centred on 1.0 and respects the ratio cap.
{
  const lo = repMultiplier(0);
  const mid = repMultiplier(0.5);
  const hi = repMultiplier(1);
  check('multiplier neutral at mean 0.5', approx(mid, 1.0));
  check('multiplier ratio equals cap', approx(hi / lo, DEFAULT_CONFIG.weightRatioCap), `lo=${lo} hi=${hi}`);
  check('multiplier monotonic', lo < mid && mid < hi);
}

// 7. Contributor aggregation is confidence-weighted.
{
  // One proven high-cred author + one unproven low-cred author.
  const proven = { mean: 0.9, evidence: 40 };
  const unproven = { mean: 0.3, evidence: 0 };
  const agg = aggregateContributorReputation([proven, unproven]);
  check('aggregate leans toward the proven contributor', agg > 0.75, `agg=${agg.toFixed(3)}`);
  const empty = aggregateContributorReputation([]);
  check('no contributors -> neutral 0.5', approx(empty, 0.5));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
if (failures > 0) throw new Error(`${failures} reputation-engine check(s) failed`);
