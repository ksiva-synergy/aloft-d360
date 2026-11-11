import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { denyUnlessEstatePipelineOperator } from '@/lib/estate/require-estate-pipeline-operator';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const deniedSection = await denyUnlessSection(null, ['estate.overview', 'view'], ['estate.catalog', 'view'], ['estate.mapper', 'view']);
  if (deniedSection) return deniedSection;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const orgId = await getOrgId();
    const sources = await prisma.platformContextSource.findMany({
      where: { org_id: orgId },
      orderBy: { created_at: 'desc' },
    });
    return NextResponse.json({ sources });
  } catch (err) {
    console.error('[context/sources GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await denyUnlessEstatePipelineOperator();
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;

    if (!body.connection_ref || typeof body.connection_ref !== 'string') {
      return NextResponse.json({ error: 'MISSING_FIELD', field: 'connection_ref' }, { status: 400 });
    }

    const orgId = await getOrgId();
    const connectionKind =
      typeof body.connection_kind === 'string' && body.connection_kind === 'powerbi'
        ? 'powerbi'
        : 'databricks';

    if (connectionKind === 'databricks') {
      const conn = await prisma.platformDatabricksConnection.findFirst({
        where: { id: body.connection_ref, org_id: orgId },
        select: { id: true },
      });
      if (!conn) {
        return NextResponse.json({ error: 'NOT_FOUND', field: 'connection_ref' }, { status: 404 });
      }
    } else if (!body.connection_ref.trim()) {
      return NextResponse.json({ error: 'MISSING_FIELD', field: 'connection_ref' }, { status: 400 });
    }

    const source = await prisma.platformContextSource.create({
      data: {
        org_id: orgId,
        connection_kind: connectionKind,
        connection_ref: body.connection_ref,
        display_name: typeof body.display_name === 'string' ? body.display_name : null,
        ...(Array.isArray(body.scope_include) ? { scope_include: body.scope_include } : {}),
        ...(Array.isArray(body.scope_exclude) ? { scope_exclude: body.scope_exclude } : {}),
        ...(body.harvest_config !== null &&
          typeof body.harvest_config === 'object' &&
          !Array.isArray(body.harvest_config)
            ? { harvest_config: body.harvest_config as unknown as Prisma.InputJsonObject }
            : {}),
        status: 'active',
      },
    });

    return NextResponse.json({ source }, { status: 201 });
  } catch (err) {
    console.error('[context/sources POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
