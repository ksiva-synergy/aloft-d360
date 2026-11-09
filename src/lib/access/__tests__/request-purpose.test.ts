import { describe, expect, it } from 'vitest';
import { buildAgentAccessRequestPurpose } from '../request-purpose';

describe('buildAgentAccessRequestPurpose', () => {
  it('lists agent tables without user typing table names', () => {
    const text = buildAgentAccessRequestPurpose({
      userQuestion: 'Look up crew',
      paths: ['a.b.employee', 'a.b.payroll'],
      bundleRef: 'bundle-1',
    });
    expect(text).toContain('Question in Ask Data');
    expect(text).toMatch(/Agent-identified tables/i);
    expect(text).toContain('Linked 2 requests');
  });
});
