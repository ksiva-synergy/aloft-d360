import { describe, expect, it } from 'vitest';
import {
  DATA_ROLE_TEMPLATES,
  getDataRoleTemplate,
  templateNeedsCatalogPath,
} from '@/lib/access/data-role-templates';

describe('data-role-templates', () => {
  it('includes department member templates', () => {
    expect(getDataRoleTemplate('dept_member')).toBeDefined();
    expect(getDataRoleTemplate('dept_member')?.requiresDepartment).toBe(true);
  });

  it('catalog templates need path input', () => {
    const t = getDataRoleTemplate('dept_catalog_query');
    expect(t).toBeDefined();
    expect(templateNeedsCatalogPath(t!)).toBe(true);
  });

  it('has unique keys', () => {
    const keys = DATA_ROLE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
