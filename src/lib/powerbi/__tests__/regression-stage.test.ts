import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ default: {} }));

import { stageFromTranslation } from '@/lib/powerbi/recreation-summary';

const tr = (verdict: string | null, props: Record<string, unknown> = {}) => ({
  sql_text: 'SELECT 1 AS value',
  parity_verdict: verdict,
  tier: 'expand',
  status: 'published',
  props: { parity: { summary: 'Mismatch oracle=10 sql=12' }, ...props },
});

describe('regression guardrail: a published measure that stops matching is never hidden', () => {
  it('published + now failing → regressed', () => {
    const s = stageFromTranslation(tr('fail'), 'verified');
    expect(s.stage).toBe('regressed');
    expect(s.reason).toMatch(/Matched Power BI before/);
  });

  it('demoted earlier (regressed_at) and still failing → still regressed', () => {
    expect(stageFromTranslation(tr('error', { regressed_at: '2026-11-14T00:00:00Z' }), 'candidate').stage).toBe('regressed');
  });

  it('published and still passing → published; never published and failing → plain mismatch', () => {
    expect(stageFromTranslation(tr('pass'), 'verified').stage).toBe('published');
    expect(stageFromTranslation(tr('fail'), null).stage).toBe('parity_fail');
  });
});
