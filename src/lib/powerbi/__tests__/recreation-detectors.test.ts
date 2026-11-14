import { describe, expect, it } from 'vitest';

import { runDetectors } from '@/lib/powerbi/recreation-detectors';
import { classifyRootCause } from '@/lib/powerbi/recreation-root-cause';

const fail = (oracle: unknown, sql: unknown) => ({ parity: { verdict: 'fail', oracle_value: oracle, sql_value: sql } });
const names = (props: Record<string, unknown>) => runDetectors(props).map((f) => f.detector);

describe('detectors (L5)', () => {
  it('names parity value patterns', () => {
    expect(names(fail(0.4523, 45.23))).toEqual(['scale_mismatch']);
    expect(names(fail(1250, -1250))).toEqual(['sign_flip']);
    expect(names(fail(120, 360))).toEqual(['row_fanout']);
    expect(names(fail(1265, 1264))).toEqual(['boundary_rows']);
    expect(names(fail(57, null))).toEqual(['empty_sql_result']);
    expect(names(fail(null, 12))).toEqual(['blank_mismatch']);
    expect(names(fail('12 days', 12.5))).toEqual(['type_mismatch']);
    expect(names(fail(100, 170))).toEqual([]); // no known pattern: left for decomposition
  });

  it('names size, planning and deferred validation from telemetry', () => {
    const f = runDetectors({
      telemetry: { sql_chars: 23930, growth: 48, ctes: 14, test_ms: 178849, outcome: 'timeout' },
    });
    expect(f.map((x) => x.detector)).toEqual(['compiler_blowup', 'slow_plan']);
    expect(f[0]!.evidence).toContain('23,930');
    expect(names({ expand_test: { mode: 'deferred' } })).toEqual(['validation_deferred']);
  });

  it('turns structured capability gaps into countable findings', () => {
    expect(names({ expand_failure: { stage: 'compile', gap: { kind: 'm_step', name: 'Table.SplitColumn' } } })).toEqual([
      'pq_capability_gap',
    ]);
    expect(names({ expand_failure: { stage: 'compile', gap: { kind: 'dax_fn', name: 'PATH', arity: 2 } } })).toEqual([
      'dax_capability_gap',
    ]);
  });
});

describe('semantic gaps and data defects', () => {
  it('names the row-level context transition gap, from the structured gap or the stored message', () => {
    expect(names({ expand_failure: { gap: { kind: 'semantic', name: 'calculate_row_transition' } } })).toEqual([
      'dax_capability_gap',
    ]);
    expect(
      names({
        expand_failure: {
          reason: "CALCULATE context transition on the current row of 'CII_Enerva' without a FILTER/ALL override (not modeled)",
        },
      }),
    ).toEqual(['dax_capability_gap']);
  });

  it('names a text value that cannot be cast to a number', () => {
    const f = runDetectors({
      parity: {
        verdict: 'error',
        summary: `SQL error: sql_error: Async query FAILED: [CAST_INVALID_INPUT] The value 'N/A' of the type "STRING" cannot be cast to "DOUBLE" because it is malformed.`,
      },
    });
    expect(f.map((x) => x.detector)).toEqual(['cast_error']);
    expect(f[0]!.evidence).toContain("'N/A'");
  });
});

describe('sliced parity detector', () => {
  it('names member-level errors hidden by a matching total', () => {
    const f = runDetectors({
      parity: {
        verdict: 'fail',
        oracle_value: 100,
        sql_value: 100,
        sliced: {
          compared: 4,
          mismatched: 2,
          dimension: { table: 'Ships', column: 'KEY' },
          examples: [{ key: 'a', power_bi: 10, sql: 12 }],
        },
      },
    });
    expect(f.map((x) => x.detector)).toContain('slice_mismatch');
    expect(f.find((x) => x.detector === 'slice_mismatch')!.evidence).toMatch(/2 of 4 Ships\[KEY\]/);
  });
});

describe('root-cause precision', () => {
  const classify = (stage: string, props: Record<string, unknown>) =>
    classifyRootCause({ stage, dax: 'SUM(T[x])', tier: 'expand', props, catalog: null })!;

  it('a bare parity mismatch is not precise; a named pattern makes it precise', () => {
    expect(classify('parity_fail', fail(100, 170)).precise).toBe(false);
    const fanout = classify('parity_fail', fail(120, 360));
    expect(fanout.category).toBe('parity_mismatch');
    expect(fanout.precise).toBe(true);
    expect(fanout.evidence?.[0]?.detector).toBe('row_fanout');
  });

  it('specific categories are precise on their own; a decomposition result makes any cause precise', () => {
    expect(classify('no_sql', { fidelity_block: { reason: 'x', issues: [{ kind: 'replica_drift' }] } }).precise).toBe(true);
    expect(
      classify('parity_fail', { ...fail(100, 170), investigation: { first_difference: { part: '[Base]' } } }).precise,
    ).toBe(true);
  });
});
