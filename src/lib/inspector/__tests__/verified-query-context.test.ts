import { describe, expect, it } from 'vitest';
import { formatVerifiedQueryBlock } from '@/lib/inspector/verified-query-format';

describe('formatVerifiedQueryBlock', () => {
  it('returns empty string when no hits', () => {
    expect(formatVerifiedQueryBlock([])).toBe('');
  });

  it('includes id and run_verified_query guidance', () => {
    const text = formatVerifiedQueryBlock([
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        question: 'What is Total CII?',
        sql: 'SELECT 1',
        score: 0.88,
        origin: 'powerbi',
        props: { model_name: 'CII Report 2024' },
      },
    ]);
    expect(text).toContain('run_verified_query');
    expect(text).toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(text).toContain('CII Report 2024');
  });
});
