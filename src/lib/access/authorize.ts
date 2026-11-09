import { prisma } from '@/lib/db';
import { accessMode, isSurfaceEnforced, shouldEvaluateAccess } from './config';
import { AccessDeniedError } from './errors';
import { authorizeWithModel, missingPathProtections, PLATFORM_ADMIN_ROLE } from './engine';

/** Extractor failures that are only about naming tables, not about what the statement does. */
const UNRESOLVED_NAMES = /^(Use fully qualified|Table-valued functions|Dynamic IDENTIFIER)/;
import { getAccessModel } from './model-store';
import { extractTablesForAuthorization } from './sql-tables';
import { requestUrlForAccess, tableDenialMessage } from './denial-ui';
import type {
  AccessPrincipal,
  AuthorizeContext,
  AuthorizePathsResult,
  DataTier,
  Level,
} from './types';

export type { AuthorizePathsResult };

function userIdForLog(principal: AccessPrincipal): string | null {
  return principal.kind === 'user' ? principal.userId : null;
}

/**
 * Every decision for a person is logged, allowed reads included, so "who read table X?" can be answered
 * for all data (review: partial logging). System principals (harvest, sync) are only logged when refused.
 */
function shouldLogDecision(principal: AccessPrincipal, result: AuthorizePathsResult): boolean {
  if (!result.ok) return true;
  return principal.kind === 'user';
}

async function writeDecisionLog(
  principal: AccessPrincipal,
  paths: string[],
  level: Level,
  ctx: AuthorizeContext,
  result: AuthorizePathsResult,
  tier?: DataTier,
  allowReason?: string,
): Promise<void> {
  const mode = accessMode() === 'enforce' ? 'enforce' : 'observe';
  if (!shouldLogDecision(principal, result)) return;

  try {
    await prisma.accessDecisionLog.create({
      data: {
        org_id: principal.orgId,
        user_id: userIdForLog(principal),
        surface: ctx.surface,
        level,
        paths,
        decision: result.ok ? 'allow' : 'deny',
        reason: result.ok ? allowReason : result.reason,
        mode,
        session_id: ctx.sessionId,
        tier: tier ?? null,
      },
    });
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2021') {
      return;
    }
    console.warn('[access/authorize] failed to write decision log', err);
  }
}

function denialMessage(result: Extract<AuthorizePathsResult, { ok: false }>, protections: string[]): string {
  return tableDenialMessage(result.failedPath, result.reason, protections);
}

export async function authorizePaths(
  principal: AccessPrincipal,
  paths: string[],
  level: Level,
  ctx: AuthorizeContext,
): Promise<{ ok: true; tier: DataTier } | { ok: false; error: AccessDeniedError }> {
  if (!shouldEvaluateAccess()) {
    return { ok: true, tier: 'internal' };
  }

  // Simplified model (docs/access/simplified-access-model.md): access rules + protections.
  const { model } = await getAccessModel(principal.orgId);
  const result = authorizeWithModel(model, principal, paths, level);

  if (result.ok) {
    await writeDecisionLog(principal, paths, level, ctx, result, result.tier);
    return { ok: true, tier: result.tier };
  }

  await writeDecisionLog(principal, paths, level, ctx, result);

  const block = isSurfaceEnforced(ctx.surface);
  const protections = result.failedPath ? missingPathProtections(model, principal, result.failedPath) : [];
  const failedPath = result.failedPath;
  const requestUrl = requestUrlForAccess({ path: failedPath, queryPaths: result.visiblePaths });
  const error = new AccessDeniedError(denialMessage(result, protections), {
    reason: result.reason,
    surface: ctx.surface,
    level,
    paths: result.visiblePaths,
    label: result.label,
    failedPath,
    requestUrl,
  });

  if (block) return { ok: false, error };

  return { ok: true, tier: 'internal' };
}

export async function authorizeSql(
  principal: AccessPrincipal,
  sql: string,
  level: Level,
  ctx: AuthorizeContext,
): Promise<{ tier: DataTier }> {
  const extracted = extractTablesForAuthorization(sql);
  if (!extracted.ok) {
    if (!shouldEvaluateAccess()) return { tier: 'internal' };
    // Platform admins may read every table, so "couldn't tell which tables" doesn't matter for them.
    // Writes, DDL and system / information_schema / samples are still refused.
    if (principal.kind === 'user' && (principal.roles ?? []).includes(PLATFORM_ADMIN_ROLE) && UNRESOLVED_NAMES.test(extracted.reason)) {
      // Logged, so admin reads that skipped name resolution still show in the audit trail.
      await writeDecisionLog(principal, [], level, ctx, { ok: true, tier: 'internal', decisions: new Map() }, 'internal', 'platform_admin_unresolved');
      return { tier: 'internal' };
    }
    const fail: Extract<AuthorizePathsResult, { ok: false }> = {
      ok: false,
      reason: 'sql_unresolved',
      visiblePaths: [],
    };
    await writeDecisionLog(principal, [], level, ctx, fail);
    const error = new AccessDeniedError(tableDenialMessage(undefined, 'sql_unresolved', []), {
      reason: 'sql_unresolved',
      surface: ctx.surface,
      level,
      paths: [],
      requestUrl: requestUrlForAccess({}),
    });
    if (isSurfaceEnforced(ctx.surface)) throw error;
    return { tier: 'internal' };
  }

  if (extracted.paths.length === 0) {
    return { tier: 'internal' };
  }

  const result = await authorizePaths(principal, extracted.paths, level, ctx);
  if (!result.ok) throw result.error;
  return { tier: result.tier };
}
