import { prisma } from '@/lib/db';
import { accessMode, isSurfaceEnforced, shouldEvaluateAccess } from './config';
import { authorizePaths as decideAuthorizePaths } from './decide';
import { AccessDeniedError } from './errors';
import { enrichUserPrincipal } from './principal';
import { loadPolicySnapshot } from './policy-store';
import { extractTablesForAuthorization } from './sql-tables';
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

function shouldLogDecision(result: AuthorizePathsResult, tier: DataTier | undefined): boolean {
  if (!result.ok) return true;
  return tier === 'confidential' || tier === 'restricted';
}

async function writeDecisionLog(
  principal: AccessPrincipal,
  paths: string[],
  level: Level,
  ctx: AuthorizeContext,
  result: AuthorizePathsResult,
  tier?: DataTier,
): Promise<void> {
  const mode = accessMode() === 'enforce' ? 'enforce' : 'observe';
  if (!shouldLogDecision(result, tier)) return;

  try {
    await prisma.accessDecisionLog.create({
      data: {
        org_id: principal.orgId,
        user_id: userIdForLog(principal),
        surface: ctx.surface,
        level,
        paths,
        decision: result.ok ? 'allow' : 'deny',
        reason: result.ok ? undefined : result.reason,
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

function denialMessage(result: Extract<AuthorizePathsResult, { ok: false }>): string {
  if (result.reason === 'needs_clearance') {
    return 'You do not have clearance for one or more tables in this query.';
  }
  if (result.reason === 'explicit_deny') {
    return 'Access to one or more tables was explicitly denied.';
  }
  return 'One or more tables are not available to you.';
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

  const snapshot = await loadPolicySnapshot(principal.orgId);
  const effective =
    principal.kind === 'user' ? enrichUserPrincipal(principal, snapshot) : principal;

  const result = decideAuthorizePaths(effective, paths, level, snapshot);

  if (result.ok) {
    await writeDecisionLog(principal, paths, level, ctx, result, result.tier);
    return { ok: true, tier: result.tier };
  }

  await writeDecisionLog(principal, paths, level, ctx, result);

  const block = isSurfaceEnforced(ctx.surface);
  const error = new AccessDeniedError(denialMessage(result), {
    reason: result.reason,
    surface: ctx.surface,
    level,
    paths: result.visiblePaths,
    label: result.label,
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
    const fail: Extract<AuthorizePathsResult, { ok: false }> = {
      ok: false,
      reason: 'sql_unresolved',
      visiblePaths: [],
    };
    await writeDecisionLog(principal, [], level, ctx, fail);
    const error = new AccessDeniedError(extracted.reason, {
      reason: 'sql_unresolved',
      surface: ctx.surface,
      level,
      paths: [],
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
