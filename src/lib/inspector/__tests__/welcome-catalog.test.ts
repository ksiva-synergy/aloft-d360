import { describe, expect, it } from 'vitest';
import {
  buildWelcomeCatalog,
  buildDomainOffers,
  humanizeSchema,
  isStakeholderFacingLine,
  type WelcomeObject,
} from '../welcome-catalog';
import type { WelcomeDepartmentDef } from '../welcome-departments';

const obj = (
  fullPath: string,
  kw: string[] = [],
  t0?: string,
  semantic?: WelcomeObject['semantic'],
): WelcomeObject => {
  const parts = fullPath.split('.');
  return {
    full_path: fullPath,
    catalog_name: parts[0] ?? null,
    schema_name: parts[1] ?? null,
    object_name: parts[parts.length - 1] ?? null,
    domain_keywords: kw,
    last_t0_at: t0 ? new Date(t0) : null,
    semantic,
  };
};

const CREWING_PATH = 'curated_db.db_smac_prod_navitasai_crewing_public';

describe('isStakeholderFacingLine', () => {
  it('rejects warehouse paths and table-like tokens', () => {
    expect(isStakeholderFacingLine('curated_db.db_smac_prod.navitasai_crewing_public')).toBe(false);
    expect(isStakeholderFacingLine('crew_scorecard')).toBe(false);
    expect(isStakeholderFacingLine('Seafarer certificates and rotations')).toBe(true);
  });
});

describe('humanizeSchema', () => {
  it('drops medallion layer words', () => {
    expect(humanizeSchema('sales_gold')).toBe('Sales');
  });
});

describe('buildWelcomeCatalog', () => {
  const crewingDept: WelcomeDepartmentDef[] = [
    { key: 'crewing', name: 'CREWING', paths: [CREWING_PATH] },
  ];

  it('groups by business domain from department paths', () => {
    const c = buildWelcomeCatalog(
      [
        obj(`${CREWING_PATH}.crew`, ['seafarer', 'rotation']),
        obj(`${CREWING_PATH}.docs`, ['certificates']),
        obj('reporting_layer.finance.ledger', ['revenue'], '2026-11-01T00:00:00Z'),
      ],
      { departments: crewingDept },
    );
    expect(c.totalTables).toBe(3);
    const crewing = c.areas.find((a) => a.key === 'crewing');
    const finance = c.areas.find((a) => a.key === 'finance');
    expect(crewing?.label).toBe('Crewing');
    expect(crewing?.tableCount).toBe(2);
    expect(finance?.label).toBe('Finance');
    expect(finance?.tableCount).toBe(1);
  });

  it('uses T2 semantics in covers and offers', () => {
    const c = buildWelcomeCatalog(
      [
        obj(`${CREWING_PATH}.t1`, ['crew'], undefined, {
          entity: 'Seafarer assignment',
          summary: 'Crew rotations and contracts.',
          intents: ['Track overdue certificates by vessel'],
        }),
      ],
      { departments: crewingDept },
    );
    expect(c.areas[0].covers.some((x) => x.includes('Seafarer') || x.includes('Track overdue'))).toBe(true);
    expect(c.areas[0].offers[0].label).toContain('Track overdue certificates');
  });

  it('filters technical ETL/schema noise out of T2 intents and tags subtopics', () => {
    const c = buildWelcomeCatalog(
      [
        obj('darwin_box.curated_db.employee_master_ranked', ['employee'], undefined, {
          entity: 'employee',
          summary: 'Shore employee master.',
          intents: [
            'Inspect table schema and column metadata',
            'Resolve type id by code',
            'Headcount by office and employment type',
            'Lookup employee and direct manager',
          ],
        }),
      ],
    );
    const hr = c.areas.find((a) => a.key === 'hr');
    expect(hr?.offers[0].label).toBe('Headcount by office and employment type');
    expect(hr?.offers[0].topic).toBe('Headcount & Offices');
    expect(hr?.offers.some((o) => /schema|resolve type/i.test(o.label))).toBe(false);
    expect(hr?.subtopics?.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Headcount & Offices', 'Org & Reporting Lines']),
    );
  });

  it('buildDomainOffers uses the domain label', () => {
    const offers = buildDomainOffers({ label: 'Marine', topics: ['voyage', 'bunker'] });
    expect(offers[0].prompt).toContain('In Marine');
  });

  it('returns an empty catalog for no objects', () => {
    expect(buildWelcomeCatalog([])).toEqual({ totalTables: 0, totalAreas: 0, lastRefreshedAt: null, areas: [] });
  });
});
