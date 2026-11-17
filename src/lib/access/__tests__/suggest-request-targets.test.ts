import { describe, expect, it } from 'vitest';
import { purposePhrases } from '../purpose-phrases';

describe('purposePhrases', () => {
  it('splits lists and and-clauses', () => {
    expect(purposePhrases('Look up crew\nCheck payroll and manager')).toEqual([
      'Look up crew',
      'Check payroll',
      'manager',
    ]);
  });
});
