import { describe, expect, it } from 'vitest';
import {
  detailTone,
  nestedRecords,
  recordFromJson,
  recordsFromJson,
  splitDetailItem,
} from '@/components/workbench/json-table';

describe('nested record lists', () => {
  const rows = [
    { vessel: 'PIBA', findings: [{ code: 'NC-1', text: 'Mooring line chafed beyond the allowed wear limit' }] },
    { vessel: 'YOSH', findings: [{ code: 'NC-2', text: 'x' }, { code: 'NC-3', text: 'y' }] },
  ];

  it('keeps a list of objects as a records detail instead of hiding it', () => {
    const table = recordsFromJson(JSON.stringify(rows))!;
    const i = table.details.labels.indexOf('Findings');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(table.details.kinds[i]).toBe('records');
    expect(nestedRecords(table.details.rows[1][i])).toEqual({
      labels: ['Code', 'Text'],
      rows: [['NC-2', 'x'], ['NC-3', 'y']],
      total: 2,
    });
  });

  it('returns null for values that are not a list of objects', () => {
    expect(nestedRecords('a; b')).toBeNull();
    expect(nestedRecords('[]')).toBeNull();
  });
});

describe('recordFromJson', () => {
  it('splits one object into short overview pairs and separate sections', () => {
    const record = recordFromJson(JSON.stringify({
      vessel_acronym: 'SORS',
      status: '305',
      sire_reference_no: '',
      gaps: ['blank sire_reference_no', 'port missing'],
      recommended_actions: ['Obtain the OCIMF SIRE reference before any close.'],
    }))!;
    expect(record.overview).toEqual([
      { label: 'Vessel acronym', value: 'SORS' },
      { label: 'Status', value: '305' },
    ]);
    expect(record.sections.map((s) => s.label)).toEqual(['Sire reference no', 'Gaps', 'Recommended actions']);
  });

  it('ignores lists, one-field objects and non-JSON', () => {
    expect(recordFromJson('[{"a":1,"b":2}]')).toBeNull();
    expect(recordFromJson('{"only":"one"}')).toBeNull();
    expect(recordFromJson('not json')).toBeNull();
  });
});

describe('splitDetailItem', () => {
  it('splits snake_case keys with =, : or a numeric/date value', () => {
    expect(splitDetailItem('inspection_audit_by=SIRE')).toEqual({ key: 'inspection_audit_by', value: 'SIRE' });
    expect(splitDetailItem('number_of_nc 0')).toEqual({ key: 'number_of_nc', value: '0' });
    expect(splitDetailItem('target_date 2026-12-31')).toEqual({ key: 'target_date', value: '2026-12-31' });
  });

  it('leaves prose alone', () => {
    expect(splitDetailItem('sire_reference_no blank')).toBeNull();
    expect(splitDetailItem('vessel SOUTHERN RESONANCE IMO 1023516')).toBeNull();
    expect(splitDetailItem('port missing')).toBeNull();
  });
});

describe('detailTone', () => {
  it('reads the tone from the field label', () => {
    expect(detailTone('Gaps')).toBe('issue');
    expect(detailTone('Missing fields')).toBe('issue');
    expect(detailTone('Recommended actions')).toBe('action');
    expect(detailTone('Evidence')).toBe('neutral');
    expect(detailTone('Nc summary')).toBe('neutral');
    expect(detailTone('Deficiencies')).toBe('issue');
    expect(detailTone('Observations')).toBe('issue');
    expect(detailTone('Non-conformities')).toBe('issue');
    expect(detailTone('Follow-up')).toBe('action');
  });
});

const vessels = [
  { vessel_acronym: 'SOOS', sire_reference_no: '', inspection_date: '2026-10-01' },
  { vessel_acronym: 'YOSH', sire_reference_no: 'OC-19', inspection_date: '2026-10-02' },
];

describe('recordsFromJson', () => {
  it('turns an array of flat records into labeled columns', () => {
    const table = recordsFromJson(JSON.stringify(vessels));
    expect(table).toMatchObject({
      labels: ['Vessel acronym', 'Sire reference no', 'Inspection date'],
      rows: [
        ['SOOS', '—', '2026-10-01'],
        ['YOSH', 'OC-19', '2026-10-02'],
      ],
      total: 2,
      truncated: false,
    });
  });

  it('unwraps a single array field sitting next to scalar metadata', () => {
    const table = recordsFromJson(JSON.stringify({ count: 2, rows: vessels }));
    expect(table?.rows).toHaveLength(2);
    expect(table?.labels[0]).toBe('Vessel acronym');
  });

  it('unwraps common envelope keys like results', () => {
    const table = recordsFromJson(JSON.stringify({ results: vessels, meta: { ok: true } }));
    expect(table?.total).toBe(2);
  });

  it('leaves a single nested document as raw JSON', () => {
    expect(recordsFromJson(JSON.stringify({
      verified: { vessel_acronym: 'SOOS', status_code: 0 },
      gaps: ['no OCIMF SIRE reference'],
    }))).toBeNull();
    expect(recordsFromJson('not json')).toBeNull();
    expect(recordsFromJson('{"only":"one"}')).toBeNull();
  });

  it('keeps SIRE-style rows compact: short fields as columns, lists and long text in details, constants shared', () => {
    const row = (vessel: string, from: string, status: string, target: string) => ({
      vessel_acronym: vessel,
      sire_reference_no: '',
      inspection_dates: { from, to: null },
      authority: '00074',
      status,
      nc_summary: { number_of_nc: '0', major_nc_applicable: 0, target_date: target, closed_by: 'blank' },
      readiness: 'escalate',
      evidence: ['inspection_audit_by=SIRE', 'sire_type=Discharging SIRE'],
      gaps: ['sire_reference_no blank'],
      recommended_actions: ['Human reviewer: obtain OCIMF SIRE reference before any commercial use'],
    });
    const table = recordsFromJson(JSON.stringify([
      row('PIBA', '2026-10-19', '10', '2027-01-18'),
      row('YOSH', '2026-10-09', '220', '2027-01-08'),
    ]));
    expect(table).not.toBeNull();
    expect(table!.labels).toEqual(['Vessel acronym', 'Inspection dates from', 'Status', 'Target date']);
    expect(table!.rows[0]).toEqual(['PIBA', '2026-10-19', '10', '2027-01-18']);
    expect(table!.shared.map((s) => s.label)).toEqual(expect.arrayContaining([
      'Sire reference no', 'Authority', 'Number of nc', 'Major nc applicable', 'Closed by', 'Readiness',
    ]));
    expect(table!.details.labels).toEqual(['Evidence', 'Gaps', 'Recommended actions']);
    expect(table!.details.rows[0][0]).toBe('inspection_audit_by=SIRE; sire_type=Discharging SIRE');
  });

  it('keeps source casing for upper-case field names', () => {
    const table = recordsFromJson(JSON.stringify([
      { IMO_NO: '9788576', port: 'SG' },
      { IMO_NO: '9788577', port: 'AE' },
    ]));
    expect(table?.labels).toEqual(['IMO NO', 'Port']);
  });

  it('keeps a late identifier column over low-variety codes when over the column budget', () => {
    const rows = ['Alpha', 'Bravo', 'Charlie'].map((name, i) => ({
      id: `r${i}`,
      code_a: i % 2 ? 'x' : 'y',
      code_b: i % 2 ? 'x' : 'y',
      code_c: i % 2 ? 'x' : 'y',
      code_d: i % 2 ? 'x' : 'y',
      code_e: i % 2 ? 'x' : 'y',
      code_f: i % 2 ? 'x' : 'y',
      code_g: i % 2 ? 'x' : 'y',
      vessel_name: name,
    }));
    const table = recordsFromJson(JSON.stringify(rows));
    expect(table!.labels[0]).toBe('Id');
    expect(table!.labels).toContain('Vessel name');
    expect(table!.labels).toHaveLength(7);
    expect(table!.details.labels).toHaveLength(2);
  });

  it('leads with the field that identifies each row, whatever it is called or where it sits', () => {
    const table = recordsFromJson(JSON.stringify([
      { state: 'open', priority: 'high', opened: '2026-10-01', ship: 'Pacific Ibis' },
      { state: 'open', priority: 'low', opened: '2026-10-02', ship: 'Yoshino' },
      { state: 'closed', priority: 'high', opened: '2026-10-03', ship: 'Trent' },
    ]));
    expect(table!.labels).toEqual(['Ship', 'State', 'Priority', 'Opened']);
    expect(table!.rows[0]).toEqual(['Pacific Ibis', 'open', 'high', '2026-10-01']);
  });

  it('keeps a field that is blank on every row in the shared line', () => {
    const table = recordsFromJson(JSON.stringify([
      { vessel: 'A', ref: '', status: '1' },
      { vessel: 'B', ref: '', status: '2' },
    ]));
    expect(table!.shared).toEqual([{ label: 'Ref', value: '—' }]);
  });

  it('right-aligns numeric columns', () => {
    const table = recordsFromJson(JSON.stringify([
      { port: 'SG', observation: 0 },
      { port: 'AE', observation: 3 },
    ]));
    expect(table?.aligns).toEqual(['left', 'right']);
  });
});
