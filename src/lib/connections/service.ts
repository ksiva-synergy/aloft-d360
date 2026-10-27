import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/http';
import { deleteConnectionSecret, readConnectionSecret, writeConnectionSecret } from './secrets';
import { s3Provider } from './providers/s3';
import { azureBlobProvider } from './providers/azure-blob';
import { sharepointProvider } from './providers/sharepoint';
import {
  CONFIG_SCHEMA,
  CONNECTION_KINDS,
  FileTooLargeError,
  SECRET_SCHEMA,
  VISIBILITIES,
  parseAzureConnectionString,
  redact,
  type AzureBlobConfig,
  type BrowseResult,
  type ConnectionKind,
  type ConnectionSummary,
  type FileContent,
  type StorageProvider,
  type Visibility,
} from './types';

// Storage connections, self-service. Credentials go to AWS Secrets Manager; this module never
// returns them and redacts them from provider errors.
//
// Access model (same as automations): the creator owns a connection and a platform_admin can manage
// every one. The owner may share it with the organisation (`visibility: 'org'`): everyone can then
// use it (test, browse, pick it in an automation) but only the owner or a platform admin can change,
// share or delete it. Sharing never exposes the credentials. A private connection is invisible to
// everyone else (404, no existence leak).

export type Actor = { userId: string; role: string; orgId: string };

const isPlatformAdmin = (a: Actor) => a.role === 'platform_admin';

/** Connections one person may own, so a loop or a script cannot fill Secrets Manager. */
export function maxConnectionsPerUser(): number {
  const n = Number(process.env.CONNECTIONS_MAX_PER_USER);
  return Number.isInteger(n) && n > 0 ? n : 25;
}

type Row = {
  id: string;
  name: string;
  kind: string;
  config: Prisma.JsonValue;
  secret_ref: string;
  status: string;
  last_tested_at: Date | null;
  last_error: string | null;
  created_by: string;
  visibility: string;
  created_at: Date;
  updated_at: Date;
};

const canManage = (actor: Actor, r: Row) => r.created_by === actor.userId || isPlatformAdmin(actor);
const canUse = (actor: Actor, r: Row) => canManage(actor, r) || r.visibility === 'org';

const toSummary = (actor: Actor, r: Row, ownerName: string | null): ConnectionSummary => ({
  id: r.id,
  name: r.name,
  kind: r.kind as ConnectionKind,
  config: (r.config ?? {}) as Record<string, unknown>,
  status: r.status,
  lastTestedAt: r.last_tested_at,
  lastError: r.last_error,
  visibility: r.visibility === 'org' ? 'org' : 'private',
  createdBy: r.created_by,
  ownerName,
  mine: r.created_by === actor.userId,
  canManage: canManage(actor, r),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function ownerNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

async function summarize(actor: Actor, row: Row) {
  return toSummary(actor, row, (await ownerNames([row.created_by])).get(row.created_by) ?? null);
}

const nameSchema = z.string().trim().min(1).max(80);

function issues(e: z.ZodError) {
  return e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

function visibilityOf(v: unknown, fallback: Visibility): Visibility {
  if (v === undefined) return fallback;
  if (!VISIBILITIES.includes(v as Visibility)) throw new ApiError(422, `visibility must be one of ${VISIBILITIES.join(', ')}`);
  return v as Visibility;
}

/** Validates config and secret for a kind, and derives safe extra config (the Blob account name). */
function validate(kind: ConnectionKind, config: unknown, secret: unknown | undefined) {
  const c = CONFIG_SCHEMA[kind].safeParse(config ?? {});
  if (!c.success) throw new ApiError(422, 'The connection settings are not valid', { issues: issues(c.error) });
  const out: { config: Record<string, unknown>; secret?: Record<string, string> } = { config: c.data };
  if (secret !== undefined) {
    const s = SECRET_SCHEMA[kind].safeParse(secret);
    if (!s.success) throw new ApiError(422, 'The credentials are not valid', { issues: issues(s.error) });
    out.secret = s.data as Record<string, string>;
    if (kind === 'azure_blob') {
      const parsed = parseAzureConnectionString(out.secret.connectionString!);
      if (!parsed.ok) throw new ApiError(422, 'The connection string is not valid', { issues: [{ path: 'connectionString', message: parsed.error }] });
      out.config = { ...out.config, accountName: parsed.accountName };
    }
  }
  return out;
}

/** `use`: owner, platform admin, or shared with the org. `manage`: owner or platform admin. */
async function load(actor: Actor, id: string, need: 'use' | 'manage'): Promise<Row> {
  const row = await prisma.platformConnection.findUnique({ where: { id } });
  // Same answer for "missing", "other org" and "someone else's private connection".
  if (!row || row.org_id !== actor.orgId || !canUse(actor, row)) throw new ApiError(404, 'Connection not found');
  if (need === 'manage' && !canManage(actor, row)) throw new ApiError(403, 'Only the owner of this connection can change, share or delete it');
  return row;
}

export function providerFor(kind: ConnectionKind, config: Record<string, unknown>, secret: Record<string, string>): StorageProvider {
  switch (kind) {
    case 's3':
      return s3Provider(config as never, secret as never);
    case 'azure_blob':
      return azureBlobProvider(config as AzureBlobConfig, secret as never);
    case 'sharepoint':
      return sharepointProvider(config as never, secret as never);
  }
}

async function liveProvider(row: Row) {
  if (!row.secret_ref) throw new ApiError(409, 'This connection has no credentials yet');
  const secret = await readConnectionSecret(row.secret_ref);
  return { provider: providerFor(row.kind as ConnectionKind, (row.config ?? {}) as Record<string, unknown>, secret), secrets: Object.values(secret) };
}

/** The caller's own connections plus those shared with the organisation (every one for a platform admin). */
export async function listConnections(actor: Actor, kind?: ConnectionKind): Promise<ConnectionSummary[]> {
  const rows = await prisma.platformConnection.findMany({
    where: {
      org_id: actor.orgId,
      ...(kind ? { kind } : {}),
      ...(isPlatformAdmin(actor) ? {} : { OR: [{ created_by: actor.userId }, { visibility: 'org' }] }),
    },
    orderBy: { name: 'asc' },
    take: 500,
  });
  const names = await ownerNames(rows.map((r) => r.created_by));
  return rows.map((r) => toSummary(actor, r, names.get(r.created_by) ?? null));
}

export async function getConnection(actor: Actor, id: string) {
  return summarize(actor, await load(actor, id, 'use'));
}

export async function createConnection(actor: Actor, input: { name: unknown; kind: unknown; config: unknown; secret: unknown; visibility?: unknown }) {
  const name = nameSchema.safeParse(input.name);
  if (!name.success) throw new ApiError(422, 'A name is required (up to 80 characters)');
  if (!CONNECTION_KINDS.includes(input.kind as ConnectionKind)) throw new ApiError(422, `kind must be one of ${CONNECTION_KINDS.join(', ')}`);
  const kind = input.kind as ConnectionKind;
  const visibility = visibilityOf(input.visibility, 'private');
  const v = validate(kind, input.config, input.secret ?? {});
  const limit = maxConnectionsPerUser();
  if ((await prisma.platformConnection.count({ where: { org_id: actor.orgId, created_by: actor.userId } })) >= limit) {
    throw new ApiError(409, `You already have ${limit} connections. Delete one you no longer use, or use a shared one.`, { code: 'connection_limit' });
  }

  let row: Row;
  try {
    row = await prisma.platformConnection.create({
      data: { org_id: actor.orgId, name: name.data, kind, config: v.config as Prisma.InputJsonValue, created_by: actor.userId, visibility },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, `You already have a connection named "${name.data}"`);
    throw e;
  }
  try {
    const secretRef = await writeConnectionSecret(row.id, v.secret!);
    row = await prisma.platformConnection.update({ where: { id: row.id }, data: { secret_ref: secretRef } });
  } catch (e) {
    // No half-created connection: remove the row if the credentials could not be stored.
    await prisma.platformConnection.delete({ where: { id: row.id } }).catch(() => {});
    console.error('[connections] storing credentials failed:', e instanceof Error ? e.name : 'error');
    throw new ApiError(502, 'The credentials could not be stored in AWS Secrets Manager. Nothing was saved.');
  }
  await writeAudit({ actorId: actor.userId, action: 'connection.created', entityType: 'connection', entityId: row.id, after: { name: row.name, kind, config: v.config, visibility } });
  return summarize(actor, row);
}

/**
 * Owner or platform admin. Updates the name, settings and sharing; credentials change only when
 * `secret` is given. New settings or credentials reset the test status; renaming or sharing does not.
 */
export async function updateConnection(actor: Actor, id: string, input: { name?: unknown; config?: unknown; secret?: unknown; visibility?: unknown }) {
  const row = await load(actor, id, 'manage');
  const kind = row.kind as ConnectionKind;
  let name = row.name;
  if (input.name !== undefined) {
    const parsed = nameSchema.safeParse(input.name);
    if (!parsed.success) throw new ApiError(422, 'A name is required (up to 80 characters)');
    name = parsed.data;
  }
  const visibility = visibilityOf(input.visibility, row.visibility === 'org' ? 'org' : 'private');
  const v = validate(kind, input.config ?? row.config, input.secret);
  // Keep the derived Blob account name unless the connection string changed.
  const config = kind === 'azure_blob' && !v.secret ? { ...v.config, accountName: (row.config as Record<string, unknown>)?.accountName } : v.config;
  const retest = input.config !== undefined || !!v.secret;
  if (v.secret) await writeConnectionSecret(row.id, v.secret);
  let updated: Row;
  try {
    updated = await prisma.platformConnection.update({
      where: { id },
      data: {
        name,
        visibility,
        config: config as Prisma.InputJsonValue,
        ...(retest ? { status: 'untested', last_error: null } : {}),
        ...(v.secret ? { secret_ref: `aloft/connections/${row.id}` } : {}),
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, `The owner already has a connection named "${name}"`);
    throw e;
  }
  await writeAudit({
    actorId: actor.userId,
    action: 'connection.updated',
    entityType: 'connection',
    entityId: id,
    before: { name: row.name, config: row.config, visibility: row.visibility },
    after: { name, config, visibility, credentialsChanged: !!v.secret },
  });
  return summarize(actor, updated);
}

/** Owner or platform admin. */
export async function deleteConnection(actor: Actor, id: string) {
  const row = await load(actor, id, 'manage');
  if (row.secret_ref) await deleteConnectionSecret(row.secret_ref);
  await prisma.platformConnection.delete({ where: { id } });
  await writeAudit({
    actorId: actor.userId,
    action: 'connection.deleted',
    entityType: 'connection',
    entityId: id,
    before: { name: row.name, kind: row.kind, visibility: row.visibility },
  });
}

/** Anyone who may use it. Calls the provider and records the outcome; errors are redacted first. */
export async function testConnection(actor: Actor, id: string) {
  const row = await load(actor, id, 'use');
  let status: 'ok' | 'error';
  let detail: string;
  let secrets: string[] = [];
  try {
    const live = await liveProvider(row);
    secrets = live.secrets;
    detail = await live.provider.test();
    status = 'ok';
  } catch (e) {
    if (e instanceof ApiError) throw e;
    status = 'error';
    detail = redact(e instanceof Error ? e.message : String(e), secrets);
  }
  const updated = await prisma.platformConnection.update({
    where: { id },
    data: { status, last_tested_at: new Date(), last_error: status === 'error' ? detail : null },
  });
  await writeAudit({ actorId: actor.userId, action: 'connection.tested', entityType: 'connection', entityId: id, after: { status } });
  return { connection: await summarize(actor, updated), ok: status === 'ok', detail };
}

/**
 * Anyone who may use it. Downloads one file inside the connection's root folder; a file over
 * `maxBytes` is refused before it is downloaded (413). Provider errors are redacted.
 */
export async function readConnectionFile(actor: Actor, id: string, path: string, maxBytes: number): Promise<FileContent & { connection: { id: string; name: string; kind: ConnectionKind } }> {
  if (!path.trim() || path.split('/').includes('..')) throw new ApiError(400, 'Give a file path inside the connection, without ".."');
  const row = await load(actor, id, 'use');
  const { provider, secrets } = await liveProvider(row);
  try {
    const file = await provider.read(path, maxBytes);
    return { ...file, connection: { id: row.id, name: row.name, kind: row.kind as ConnectionKind } };
  } catch (e) {
    if (e instanceof FileTooLargeError) throw new ApiError(413, e.message);
    throw new ApiError(502, redact(e instanceof Error ? e.message : String(e), secrets));
  }
}

/** Anyone who may use it. One folder level, inside the connection's root folder. */
export async function browseConnection(actor: Actor, id: string, path: string, max = 100): Promise<BrowseResult> {
  if (path.split('/').includes('..')) throw new ApiError(400, 'The path must not contain ".."');
  const row = await load(actor, id, 'use');
  const { provider, secrets } = await liveProvider(row);
  try {
    return await provider.list(path, Math.min(Math.max(max, 1), 500));
  } catch (e) {
    throw new ApiError(502, redact(e instanceof Error ? e.message : String(e), secrets));
  }
}
