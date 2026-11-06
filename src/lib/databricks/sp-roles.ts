/**
 * Service principal roles for a Databricks connection.
 *
 * A connection (one workspace + warehouse) has a default credential, stored at
 * `aloft/databricks/{connectionId}`, plus optional per-role credentials stored
 * at `aloft/databricks/{connectionId}/{role}` and listed in
 * `platform_databricks_credentials`. Every warehouse call names the role it
 * acts as. A role without its own credential falls back to the default one
 * unless the role is listed in DATABRICKS_SP_REQUIRED_ROLES.
 *
 * Roles are workloads, not departments. Which data a user may see is decided
 * by ALOFT (docs/access/data-access-architecture.md); the role's Unity Catalog
 * grants are the backstop.
 */

import prisma from '@/lib/db';

export const DATABRICKS_SP_ROLES = [
  'query_internal',
  'query_confidential',
  'query_restricted',
  'metadata',
  'profile',
  'publish',
] as const;

export type DatabricksSpRole = (typeof DATABRICKS_SP_ROLES)[number];

export const DATABRICKS_SP_ROLE_LABELS: Record<DatabricksSpRole, string> = {
  query_internal: 'User queries on Internal data',
  query_confidential: 'User queries that touch Confidential data',
  query_restricted: 'User queries that touch Restricted data',
  metadata: 'Catalog structure, query history and lineage (no SELECT on data)',
  profile: 'Column profiles, sample rows and row counts',
  publish: 'Create metric views (the only write)',
};

export type DataTier = 'internal' | 'confidential' | 'restricted';

export function queryRoleForTier(tier: DataTier): DatabricksSpRole {
  if (tier === 'restricted') return 'query_restricted';
  if (tier === 'confidential') return 'query_confidential';
  return 'query_internal';
}

export function isDatabricksSpRole(value: unknown): value is DatabricksSpRole {
  return typeof value === 'string' && (DATABRICKS_SP_ROLES as readonly string[]).includes(value);
}

export interface RoleBinding {
  role: DatabricksSpRole;
  source: 'db' | 'env';
  warehouseId: string | null;
}

export class MissingRoleCredentialError extends Error {
  constructor(readonly connectionId: string, readonly role: DatabricksSpRole) {
    super(
      `No service principal is configured for role '${role}' on Databricks connection ${connectionId}, ` +
      `and DATABRICKS_SP_REQUIRED_ROLES forbids falling back to the default credential.`,
    );
    this.name = 'MissingRoleCredentialError';
  }
}

/** Roles that must have their own credential. `all` means every role. */
export function requiredRoles(): Set<DatabricksSpRole> {
  const raw = process.env.DATABRICKS_SP_REQUIRED_ROLES?.trim().toLowerCase() ?? '';
  if (!raw) return new Set();
  if (raw === 'all') return new Set(DATABRICKS_SP_ROLES);
  return new Set(raw.split(',').map((s) => s.trim()).filter(isDatabricksSpRole));
}

function envPrefix(role: DatabricksSpRole): string {
  return `DATABRICKS_SP_${role.toUpperCase()}`;
}

/** Local-dev credentials for a role; applies to every connection. */
export function envRoleCredentials(role: DatabricksSpRole): { client_id: string; client_secret: string } | null {
  const prefix = envPrefix(role);
  const client_id = process.env[`${prefix}_CLIENT_ID`];
  const client_secret = process.env[`${prefix}_CLIENT_SECRET`];
  return client_id && client_secret ? { client_id, client_secret } : null;
}

const BINDING_TTL_MS = 60_000;

type BindingCacheEntry = { loadedAt: number; bindings: Map<DatabricksSpRole, RoleBinding> };

const _g = globalThis as typeof globalThis & {
  _databricksRoleBindingCache?: Map<string, BindingCacheEntry>;
  _databricksRoleFallbackWarned?: Set<string>;
};
if (!_g._databricksRoleBindingCache) _g._databricksRoleBindingCache = new Map();
if (!_g._databricksRoleFallbackWarned) _g._databricksRoleFallbackWarned = new Set();
const bindingCache = _g._databricksRoleBindingCache;
const fallbackWarned = _g._databricksRoleFallbackWarned;

function isMissingTableError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2021';
}

async function loadBindings(connectionId: string): Promise<Map<DatabricksSpRole, RoleBinding>> {
  const bindings = new Map<DatabricksSpRole, RoleBinding>();

  let rows: { role: string; warehouse_id: string | null }[] = [];
  try {
    rows = await prisma.platformDatabricksCredential.findMany({
      where: { connection_id: connectionId, status: { not: 'disabled' } },
      select: { role: true, warehouse_id: true },
    });
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    if (!fallbackWarned.has('__table__')) {
      fallbackWarned.add('__table__');
      console.warn('[databricks/sp-roles] platform_databricks_credentials does not exist yet; every role uses the default credential');
    }
  }

  for (const row of rows) {
    if (isDatabricksSpRole(row.role)) {
      bindings.set(row.role, { role: row.role, source: 'db', warehouseId: row.warehouse_id });
    }
  }
  for (const role of DATABRICKS_SP_ROLES) {
    if (envRoleCredentials(role)) {
      bindings.set(role, { role, source: 'env', warehouseId: bindings.get(role)?.warehouseId ?? null });
    }
  }
  return bindings;
}

export async function listRoleBindings(connectionId: string): Promise<Map<DatabricksSpRole, RoleBinding>> {
  const cached = bindingCache.get(connectionId);
  if (cached && Date.now() - cached.loadedAt < BINDING_TTL_MS) return cached.bindings;
  const bindings = await loadBindings(connectionId);
  bindingCache.set(connectionId, { loadedAt: Date.now(), bindings });
  return bindings;
}

/**
 * The role's own credential, or null when the default credential should be
 * used. Throws MissingRoleCredentialError when the role is required.
 */
export async function resolveRoleBinding(
  connectionId: string,
  role: DatabricksSpRole,
): Promise<RoleBinding | null> {
  const binding = (await listRoleBindings(connectionId)).get(role) ?? null;
  if (binding) return binding;
  if (requiredRoles().has(role)) throw new MissingRoleCredentialError(connectionId, role);

  const key = `${connectionId}:${role}`;
  if (!fallbackWarned.has(key)) {
    fallbackWarned.add(key);
    console.warn(`[databricks/sp-roles] role '${role}' has no credential on connection ${connectionId}; using the default credential`);
  }
  return null;
}

export function evictRoleBindings(connectionId: string): void {
  bindingCache.delete(connectionId);
  for (const key of [...fallbackWarned]) {
    if (key.startsWith(`${connectionId}:`)) fallbackWarned.delete(key);
  }
}
