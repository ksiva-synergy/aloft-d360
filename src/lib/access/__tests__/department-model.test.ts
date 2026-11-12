import { describe, expect, it } from 'vitest';
import { canOpen } from '../engine';
import { buildAccessModel, type AccessModelRows } from '../model-store';

const base: AccessModelRows = {
  rules: [{ holder_type: 'builtin', holder_id: 'admin', path: 'zzz', effect: 'use', allow_export: false, expires_at: null }],
  tags: [],
  pathProtections: [],
  columnTags: [],
  tagGrants: [],
  groups: [
    { id: 'g-marine', archived_at: null },
    { id: 'g-other', archived_at: null },
  ],
  members: [{ group_id: 'g-marine', user_id: 'ana', expires_at: null }],
  departments: [{ id: 'd-marine', archived_at: null }],
  departmentPaths: [
    { department_id: 'd-marine', path: 'curated_db.voyage' },
    { department_id: 'd-marine', path: 'curated_db.crew.scorecard' },
  ],
  departmentGroups: [{ department_id: 'd-marine', group_id: 'g-marine', allow_export: false }],
};
const ana = { userId: 'ana', roles: [] };
const ben = { userId: 'ben', roles: [] };

describe('departments in the access model', () => {
  it('lets a linked group use everything under a department path, including tables in a schema', () => {
    const m = buildAccessModel(base);
    expect(canOpen(m, ana, 'curated_db.voyage.legs', 'use').ok).toBe(true);
    expect(canOpen(m, ana, 'curated_db.crew.scorecard', 'use').ok).toBe(true);
  });

  it('does not open other data, or data for people outside the group', () => {
    const m = buildAccessModel(base);
    expect(canOpen(m, ana, 'curated_db.finance.ledger', 'use').ok).toBe(false);
    expect(canOpen(m, ben, 'curated_db.voyage.legs', 'use').ok).toBe(false);
  });

  it('gives export only when the link allows it', () => {
    expect(canOpen(buildAccessModel(base), ana, 'curated_db.voyage.legs', 'export').ok).toBe(false);
    const withExport = buildAccessModel({ ...base, departmentGroups: [{ department_id: 'd-marine', group_id: 'g-marine', allow_export: true }] });
    expect(canOpen(withExport, ana, 'curated_db.voyage.legs', 'export').ok).toBe(true);
  });

  it('a person in two groups gets the union of both departments', () => {
    const m = buildAccessModel({
      ...base,
      members: [...base.members, { group_id: 'g-other', user_id: 'ana', expires_at: null }],
      departments: [...(base.departments ?? []), { id: 'd-qhse', archived_at: null }],
      departmentPaths: [...(base.departmentPaths ?? []), { department_id: 'd-qhse', path: 'curated_db.incidents' }],
      departmentGroups: [...(base.departmentGroups ?? []), { department_id: 'd-qhse', group_id: 'g-other', allow_export: false }],
    });
    expect(canOpen(m, ana, 'curated_db.voyage.legs', 'use').ok).toBe(true);
    expect(canOpen(m, ana, 'curated_db.incidents.log', 'use').ok).toBe(true);
  });

  it('a Block on the path still wins over a department', () => {
    const m = buildAccessModel({
      ...base,
      rules: [...base.rules, { holder_type: 'person', holder_id: 'ana', path: 'curated_db.voyage', effect: 'block', allow_export: false, expires_at: null }],
    });
    const r = canOpen(m, ana, 'curated_db.voyage.legs', 'use');
    expect(r.ok).toBe(false);
    expect(canOpen(m, ana, 'curated_db.crew.scorecard', 'use').ok).toBe(true);
  });

  it('an archived department or archived group gives nothing', () => {
    const archivedDept = buildAccessModel({ ...base, departments: [{ id: 'd-marine', archived_at: new Date() }] });
    expect(canOpen(archivedDept, ana, 'curated_db.voyage.legs', 'use').ok).toBe(false);
    const archivedGroup = buildAccessModel({ ...base, groups: [{ id: 'g-marine', archived_at: new Date() }] });
    expect(canOpen(archivedGroup, ana, 'curated_db.voyage.legs', 'use').ok).toBe(false);
  });

  it('a protected path still needs its protection grant', () => {
    const m = buildAccessModel({
      ...base,
      tags: [{ id: 't-restricted', name: 'Restricted', key: 'restricted', archived_at: null }],
      pathProtections: [{ tag_id: 't-restricted', path: 'curated_db.voyage' }],
    });
    const r = canOpen(m, ana, 'curated_db.voyage.legs', 'use');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('protected');
  });

  it('old callers without department rows behave as before', () => {
    const { departments, departmentPaths, departmentGroups, ...legacy } = base;
    void departments; void departmentPaths; void departmentGroups;
    expect(canOpen(buildAccessModel(legacy), ana, 'curated_db.voyage.legs', 'use').ok).toBe(false);
  });
});
