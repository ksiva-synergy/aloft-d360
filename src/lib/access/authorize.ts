import { prisma } from '@/lib/db';
import { accessMode, isSurfaceEnforced, shouldEvaluateAccess } from './config';
import { AccessDeniedError } from './errors';
import { authorizeWithModel, missingPathProtections } from './engine';
import { getAccessModel } from './model-store';
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

function denialMessage(result: Extract<AuthorizePathsResult, { ok: false }>, protections: string[]): string {
  const table = result.failedPath ? ` ${result.failedPath}` : ' one or more tables';
  // Prefilled request form (My data access); the person never picks the approver.
  const link = result.failedPath ? ` Request it at /my-access?path=${encodeURIComponent(result.failedPath)}` : ' Request it at /my-access';
  if (result.reason === 'needs_clearance') {
    const what = protections.length ? `${protections.join(', ')} data` : 'protected data';
    return `You don't have access to ${what} (in${table}). If you need it, request access.${link}`;
  }
  if (result.reason === 'explicit_deny') {
    return `Access to${table} is blocked for you.`;
  }
  return `You don't have access to${table}. If you need it, request access.${link}`;
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
  const error = new AccessDeniedError(denialMessage(result, protections), {
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
