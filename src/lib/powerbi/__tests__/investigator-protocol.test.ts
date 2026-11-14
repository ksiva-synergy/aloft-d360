import { describe, expect, it } from 'vitest';

import type { ProbeResult } from '@/lib/powerbi/decompose-plan';
import { InvestigatorReply, buildCaseFile, vetProbe } from '@/lib/powerbi/investigator-protocol';
import { BUILTIN_PLAYBOOKS } from '@/lib/powerbi/playbooks';

describe('investigator probe vetting', () => {
  it('accepts scalar DAX and rejects queries, table expressions and junk', () => {
    expect(vetProbe("CALCULATE(SUM('T'[x]), 'T'[y] = 1)").ok).toBe(true);
    expect(vetProbe("COUNTROWS(VALUES('T'[c]))").ok).toBe(true);
    expect(vetProbe("EVALUATE 'T'").ok).toBe(false);
    expect(vetProbe("FILTER('T', 'T'[x] > 1)").ok).toBe(false); // would return rows
    expect(vetProbe('SUM(').ok).toBe(false);
    expect(vetProbe('x'.repeat(5000)).ok).toBe(false);
  });
});

describe('investigator case file honours the data policy', () => {
  it('keeps metadata and aggregates, withholds text values from data', () => {
    const probes: ProbeResult[] = [
      { id: '1', kind: 'row_count', label: "Rows in 'Audit'", dax: "COUNTROWS('Audit')", pbi: 5537, sql: '5543', status: 'differ' },
      { id: '2', kind: 'measure', label: '[Top Vessel]', dax: '[Top Vessel]', pbi: 'NORD KARAS', sql: 'NORD AURORA', status: 'differ' },
    ];
    const cf = buildCaseFile({
      model: 'M',
      measure: 'X',
      dax: 'SUM(Audit[Days])',
      calledMeasures: [],
      calcColumns: [],
      tables: [{ name: 'Audit', source: 'databricks', uc: 'c.s.audit', pqSteps: [] }],
      relationships: [],
      rootCause: { category: 'parity_mismatch', detail: "Mismatch oracle='ACME' sql='ACME LTD'" },
      detectors: [],
      failure: null,
      parity: { verdict: 'fail', oracle_value: 'ACME', sql_value: 12 },
      probes,
      playbooks: BUILTIN_PLAYBOOKS.slice(0, 1),
    });
    const text = JSON.stringify(cf);
    expect(cf.data_policy).toBe('metadata+aggregates');
    expect(cf.decomposition[0]).toMatchObject({ power_bi: 5537, sql: 5543 });
    expect(text).not.toContain('NORD');
    expect(text).not.toContain('ACME');
    expect(cf.recorded.parity).toMatchObject({ sql: 12 });
  });
});

describe('investigator reply parsing', () => {
  it('fills defaults and clamps confidence', () => {
    const r = InvestigatorReply.parse({ status: 'diagnosed', diagnosis: 'd', confidence: 7, fix: { kind: 'weird' } });
    expect(r.confidence).toBe(0);
    expect(r.fix.kind).toBe('none');
    expect(r.probes).toEqual([]);
  });
});
