import { describe, expect, it } from 'vitest';
import { describeCron } from './cron-label';

describe('describeCron', () => {
  it.each([
    ['0 4 * * *', 'Daily at 04:00 UTC'],
    ['30 2 * * ?', 'Daily at 02:30 UTC'],
    ['0 3 * * 0', 'Sundays at 03:00 UTC'],
    ['0 3 * * 7', 'Sundays at 03:00 UTC'],
    ['0 3 * * SUN', 'Sundays at 03:00 UTC'],
    ['0 6 * * mon', 'Mondays at 06:00 UTC'],
    ['15 6 * * 1-5', 'Weekdays at 06:15 UTC'],
    ['0 1 1 * *', 'Monthly on day 1 at 01:00 UTC'],
    ['0 */6 * * *', 'Every 6 hours'],
    ['5 * * * *', 'Every hour'],
    ['0 4 * * MON,WED', 'Custom schedule'],
    ['not a cron', 'Custom schedule'],
  ])('%s -> %s', (cron, label) => {
    expect(describeCron(cron)).toBe(label);
  });
});
