import { BOOST_SUITE_V1, BOOST_SUITE_V2, BOOST_SUITE_VERSION, type BoostCase } from '@/lib/boost/suite';
import { BOOST_SUITE_CII_PILOT, BOOST_SUITE_CII_VERSION } from '@/lib/boost/suite-cii';

export { BOOST_SUITE_VERSION, BOOST_SUITE_CII_VERSION };

export function allBoostCases(): BoostCase[] {
  return [...BOOST_SUITE_V1, ...BOOST_SUITE_V2, ...BOOST_SUITE_CII_PILOT];
}

export function casesForSuite(suiteVersion?: string | null): BoostCase[] {
  const v = (suiteVersion ?? '').trim();
  if (v === BOOST_SUITE_CII_VERSION) return BOOST_SUITE_CII_PILOT;
  if (v === 'all') return allBoostCases();
  return [...BOOST_SUITE_V1, ...BOOST_SUITE_V2];
}

export function suiteVersionForCaseId(caseId: string): string {
  if (BOOST_SUITE_CII_PILOT.some((c) => c.id === caseId)) return BOOST_SUITE_CII_VERSION;
  return BOOST_SUITE_VERSION;
}

export function findBoostCase(caseId: string): BoostCase | undefined {
  return allBoostCases().find((c) => c.id === caseId);
}
