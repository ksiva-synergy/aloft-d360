/**
 * Server-side section access checks for route handlers. See ./registry.ts for the model.
 *
 * Roles and permissions are re-read from the database on every call (authenticateSession /
 * resolveAuth), so a demoted person loses access even while their JWT is still valid.
 */
import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/http';
import { authenticateSession, resolveAuth, type AuthContext } from '@/middleware/auth';
import { SECTION_BY_ID, atLeast, resolveSectionLevels, type SectionLevel, type SectionLevels } from './registry';

export type Requirement = readonly [sectionId: string, min: Exclude<SectionLevel, 'none'>];

export function levelsForContext(ctx: AuthContext): SectionLevels {
  return resolveSectionLevels([ctx.role], ctx.permissions);
}

function deniedMessage(sectionId: string, min: Exclude<SectionLevel, 'none'>): string {
  const s = SECTION_BY_ID.get(sectionId);
  const label = s?.label ?? sectionId;
  if (min === 'manage' && s?.manageIsPlatformAdminOnly) {
    return s.group === 'estate'
      ? 'Only platform admins can take actions in the Data Estate.'
      : `Only platform admins can take actions in ${label}.`;
  }
  return min === 'manage' ? `You can view ${label} but not change it.` : `You do not have access to ${label}.`;
}

/** View for GET/HEAD, manage for anything that changes state. */
export function minForMethod(method: string): Exclude<SectionLevel, 'none'> {
  return method === 'GET' || method === 'HEAD' ? 'view' : 'manage';
}

/**
 * For handlers wrapped in `handle()`: throws ApiError(403) unless `ctx` meets at least one requirement.
 */
export function requireSection(ctx: AuthContext, ...any: Requirement[]): void {
  if (meetsAny(levelsForContext(ctx), any)) return;
  const [id, min] = any[0];
  throw new ApiError(403, deniedMessage(id, min), { section: id, required: min });
}

/** True when `levels` meets at least one requirement. */
export function meetsAny(levels: SectionLevels, any: readonly Requirement[]): boolean {
  return any.some(([id, min]) => atLeast(levels[id] ?? 'none', min));
}

/**
 * Returns a JSON 401/403 response, or null when the caller meets at least one requirement.
 * Pass `req` when the handler has one (supports Bearer callers); otherwise the cookie session is used.
 */
export async function denyUnlessSection(
  req: Request | null,
  ...any: Requirement[]
): Promise<NextResponse | null> {
  let ctx: AuthContext | null;
  try {
    ctx = req ? await resolveAuth(req) : await authenticateSession();
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: e.message }, { status: e.status });
    throw e;
  }
  if (!ctx) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (meetsAny(levelsForContext(ctx), any)) return null;
  const [id, min] = any[0];
  return NextResponse.json(
    { error: 'FORBIDDEN', message: deniedMessage(id, min), details: { section: id, required: min } },
    { status: 403 },
  );
}
