import { describe, expect, it } from 'vitest';
import { recordsFromJson } from '@/components/workbench/json-table';

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

  it('leaves nested documents as raw JSON', () => {
    expect(recordsFromJson(JSON.stringify({
      verified: { vessel_acronym: 'SOOS', status_code: 0 },
      gaps: ['no OCIMF SIRE reference'],
    }))).toBeNull();
    expect(recordsFromJson('not json')).toBeNull();
    expect(recordsFromJson('{"only":"one"}')).toBeNull();
  });

  it('right-aligns numeric columns', () => {
    const table = recordsFromJson(JSON.stringify([
      { port: 'SG', observation: 0 },
      { port: 'AE', observation: 3 },
    ]));
    expect(table?.aligns).toEqual(['left', 'right']);
  });
});
