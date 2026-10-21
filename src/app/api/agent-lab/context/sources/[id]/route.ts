import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) {
    throw new Error(`INVALID_${field}`);
  }
  return value;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;

  try {
    const orgId = await getOrgId();
    const source = await prisma.platformContextSource.findFirst({
      where: { id, org_id: orgId },
    });
    if (!source) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ source });
  } catch (err) {
    console.error('[context/sources/:id GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

/**
 * PATCH body (all optional):
 *   scope_include: string[]  e.g. ["*.*.*"] or ["curated_db.*", "open_analytics_zone.*"]
 *   scope_exclude: string[]  e.g. ["landing_zone.*"]
 *   display_name: string
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;

  try {
    const orgId = await getOrgId();
    const existing = await prisma.platformContextSource.findFirst({
      where: { id, org_id: orgId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const body = await req.json() as Record<string, unknown>;

    let scopeInclude: string[] | undefined;
    let scopeExclude: string[] | undefined;
    try {
      scopeInclude = parseStringArray(body.scope_include, 'SCOPE_INCLUDE');
      scopeExclude = parseStringArray(body.scope_exclude, 'SCOPE_EXCLUDE');
    } catch (e) {
      const code = e instanceof Error ? e.message : 'INVALID_BODY';
      return NextResponse.json({ error: code }, { status: 400 });
    }

    const data: Prisma.PlatformContextSourceUpdateInput = {};
    if (scopeInclude !== undefined) {
      data.scope_include = scopeInclude as unknown as Prisma.InputJsonValue;
    }
    if (scopeExclude !== undefined) {
      data.scope_exclude = scopeExclude as unknown as Prisma.InputJsonValue;
    }
    if (typeof body.display_name === 'string') {
      data.display_name = body.display_name;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'NO_FIELDS' }, { status: 400 });
    }

    const source = await prisma.platformContextSource.update({
      where: { id },
      data,
    });

    return NextResponse.json({ source });
  } catch (err) {
    console.error('[context/sources/:id PATCH]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

/**
 * POST — restore discovery rows soft-removed by a partial estate_inventory sweep.
 * Body (optional): { widenScope?: boolean } — if true, sets scope_include to ["*.*.*"].
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;

  try {
    const orgId = await getOrgId();
    const existing = await prisma.platformContextSource.findFirst({
      where: { id, org_id: orgId },
    });
    if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { widenScope?: boolean };

    const restored = await prisma.$executeRawUnsafe(
      `UPDATE platform_estate_objects
       SET lifecycle = 'active'
       WHERE org_id = $1
         AND source_id = $2
         AND lifecycle = 'removed'`,
      orgId,
      id,
    );

    let source = existing;
    if (body.widenScope) {
      source = await prisma.platformContextSource.update({
        where: { id },
        data: { scope_include: ['*.*.*'] },
      });
    }

    const activeCount = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
      `SELECT COUNT(*)::bigint AS cnt FROM platform_estate_objects
       WHERE org_id = $1 AND source_id = $2 AND lifecycle = 'active'`,
      orgId,
      id,
    );

    return NextResponse.json({
      restored,
      active_count: Number(activeCount[0]?.cnt ?? 0),
      source: {
        id: source.id,
        display_name: source.display_name,
        scope_include: source.scope_include,
        scope_exclude: source.scope_exclude,
      },
    });
  } catch (err) {
    console.error('[context/sources/:id POST restore]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
