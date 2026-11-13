import { describe, expect, it } from 'vitest';

import { extractJsonObject, validateLlmSql } from '@/lib/powerbi/translate-llm-validate';

describe('translate-llm helpers', () => {
  it('extracts JSON from fenced response', () => {
    const raw = 'Here:\n```json\n{"sql":"SELECT 1"}\n```';
    expect(JSON.parse(extractJsonObject(raw))).toEqual({ sql: 'SELECT 1' });
  });

  it('accepts safe SELECT', () => {
    expect(validateLlmSql('SELECT SUM(`x`) AS value FROM `a`.`b`.`c`')).toContain('SELECT');
  });

  it('accepts WITH … SELECT', () => {
    expect(validateLlmSql('WITH x AS (SELECT 1) SELECT 1 AS value')).not.toBeNull();
  });

  it('rejects destructive SQL', () => {
    expect(validateLlmSql('SELECT 1; DROP TABLE x')).toBeNull();
  });
});
