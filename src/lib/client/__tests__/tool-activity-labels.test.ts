import { describe, expect, it } from 'vitest';
import { friendlyToolActivityLabel } from '../tool-activity-labels';

describe('friendlyToolActivityLabel', () => {
  it('maps known tools to plain language', () => {
    expect(friendlyToolActivityLabel('describe_schema')).toBe('Reviewing the data catalog');
    expect(friendlyToolActivityLabel('execute_tool')).toBe('Querying data');
  });
});
