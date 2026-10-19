import { describe, expect, it } from 'vitest';
import { redactToolPayload, extractToolErrorFromJson } from '../redact';

describe('redactToolPayload', () => {
  it('redacts secret keys', () => {
    const out = redactToolPayload({ client_secret: 'abc', statement: 'SELECT 1' }) as Record<string, unknown>;
    expect(out.client_secret).toBe('[REDACTED]');
    expect(out.statement).toBe('SELECT 1');
  });

  it('truncates long SQL', () => {
    const sql = 'SELECT ' + 'x'.repeat(600);
    const out = redactToolPayload({ statement: sql }) as { statement: { _truncated: boolean; preview: string } };
    expect(out.statement._truncated).toBe(true);
    expect(out.statement.preview.length).toBeLessThanOrEqual(500);
  });

  it('omits large row arrays', () => {
    const out = redactToolPayload({ rows: [1, 2, 3, 4] }) as Record<string, unknown>;
    expect(out).toEqual({ rows: { _omitted: 'rows', length: 4 } });
  });
});

describe('extractToolErrorFromJson', () => {
  it('reads error field', () => {
    expect(extractToolErrorFromJson(JSON.stringify({ error: 'boom' }))).toBe('boom');
  });
});
