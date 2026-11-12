import type { Level } from './types';

export type DataRoleTemplateGrant = {
  path: string;
  level: Level;
  /** When true, `path` is taken from the apply request (`catalogPath`). */
  useCatalogPathFromRequest?: boolean;
};

export type DataRoleTemplate = {
  key: string;
  name: string;
  description: string;
  requiresDepartment: boolean;
  /** Apply body must include `catalogPath` when any grant uses `useCatalogPathFromRequest`. */
  grantSpecs: DataRoleTemplateGrant[];
  clearance: 'confidential' | 'restricted' | null;
};

/** Built-in data roles — org-wide templates (not app login roles). */
export const DATA_ROLE_TEMPLATES: DataRoleTemplate[] = [
  {
    key: 'dept_member',
    name: 'Department member',
    description:
      'Adds the person to a department. They inherit every path grant already assigned to that department.',
    requiresDepartment: true,
    grantSpecs: [],
    clearance: null,
  },
  {
    key: 'dept_member_confidential',
    name: 'Department member + Confidential clearance',
    description:
      'Department membership plus clearance to use Confidential-labelled tables (path grants still required).',
    requiresDepartment: true,
    grantSpecs: [],
    clearance: 'confidential',
  },
  {
    key: 'dept_member_restricted',
    name: 'Department member + Restricted clearance',
    description:
      'Department membership plus clearance for Restricted-labelled data (path grants still required).',
    requiresDepartment: true,
    grantSpecs: [],
    clearance: 'restricted',
  },
  {
    key: 'dept_catalog_query',
    name: 'Department + catalog query',
    description:
      'Adds to a department and grants query on a catalog, schema, or table path for the whole department.',
    requiresDepartment: true,
    grantSpecs: [{ path: '', level: 'query', useCatalogPathFromRequest: true }],
    clearance: null,
  },
  {
    key: 'dept_catalog_discover',
    name: 'Department + catalog discover',
    description:
      'Adds to a department and grants discover (metadata only) on a path for the whole department.',
    requiresDepartment: true,
    grantSpecs: [{ path: '', level: 'discover', useCatalogPathFromRequest: true }],
    clearance: null,
  },
];

export function getDataRoleTemplate(key: string): DataRoleTemplate | undefined {
  return DATA_ROLE_TEMPLATES.find((t) => t.key === key);
}

export function templateNeedsCatalogPath(template: DataRoleTemplate): boolean {
  return template.grantSpecs.some((g) => g.useCatalogPathFromRequest);
}
