import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

function readFamilyCanonical(props: unknown): boolean {
  if (!props || typeof props !== 'object') return false;
  const fa = (props as Record<string, unknown>).family_assignment;
  if (!fa || typeof fa !== 'object') return false;
  return (fa as Record<string, unknown>).is_canonical === true;
}

function readFamilyKeyFromProps(props: unknown): string | null {
  if (!props || typeof props !== 'object') return null;
  const fa = (props as Record<string, unknown>).family_assignment;
  if (!fa || typeof fa !== 'object') return null;
  const key = (fa as Record<string, unknown>).family_key;
  return typeof key === 'string' ? key : null;
}

function readDomainAssignment(props: unknown): {
  domain_key: string | null;
  confidence: number | null;
} {
  if (!props || typeof props !== 'object') return { domain_key: null, confidence: null };
  const da = (props as Record<string, unknown>).domain_assignment;
  if (!da || typeof da !== 'object') return { domain_key: null, confidence: null };
  const row = da as Record<string, unknown>;
  return {
    domain_key: typeof row.domain_key === 'string' ? row.domain_key : null,
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
  };
}

function readAnswerability(props: unknown): string | null {
  if (!props || typeof props !== 'object') return null;
  const c = (props as Record<string, unknown>).classification;
  if (!c || typeof c !== 'object') return null;
  return typeof (c as Record<string, unknown>).answerability === 'string'
    ? ((c as Record<string, unknown>).answerability as string)
    : null;
}

export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim();
    const domainKey = req.nextUrl.searchParams.get('domain_key')?.trim();

    const where = {
      org_id: orgId,
      lifecycle: 'active' as const,
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
    };
    const baseSelect = {
      id: true,
      pbi_model_id: true,
      name: true,
      description: true,
      rls_required: true,
      storage_mode: true,
      workspace_id: true,
      props: true,
      updated_at: true,
      workspace: { select: { name: true, pbi_workspace_id: true } },
      domain: { select: { domain_key: true, name: true } },
      _count: { select: { tables: true, measures: true, reports: true } },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- family select may be absent until `prisma generate`
    let models: any[];
    try {
      models = await prisma.pbiModel.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
          ...baseSelect,
          family: { select: { family_key: true, name: true, varying_parameter: true } },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientValidationError && String(err.message).includes('family')) {
        models = await prisma.pbiModel.findMany({
          where,
          orderBy: { name: 'asc' },
          select: baseSelect,
        });
      } else {
        throw err;
      }
    }

    const filtered = domainKey
      ? models.filter((m) => {
          const fromRel = m.domain?.domain_key ?? null;
          const fromProps = readDomainAssignment(m.props).domain_key;
          return fromRel === domainKey || fromProps === domainKey;
        })
      : models;

    return NextResponse.json({
      models: filtered.map((m) => {
        const assignment = readDomainAssignment(m.props);
        return {
        id: m.id,
        pbi_model_id: m.pbi_model_id,
        name: m.name,
        description: m.description,
        workspace_id: m.workspace_id,
        workspace_name: m.workspace.name ?? m.workspace.pbi_workspace_id,
        rls_required: m.rls_required,
        storage_mode: m.storage_mode,
        answerability: readAnswerability(m.props),
        has_definition: Boolean(
          (m.props as Record<string, unknown>)?.definition &&
            typeof (m.props as Record<string, unknown>).definition === 'object',
        ),
        table_count: m._count.tables,
        measure_count: m._count.measures,
        report_count: m._count.reports,
        domain_key: m.domain?.domain_key ?? assignment.domain_key,
        domain_name: m.domain?.name ?? null,
        domain_confidence: assignment.confidence,
        family_key: m.family?.family_key ?? readFamilyKeyFromProps(m.props),
        family_name: m.family?.name ?? null,
        family_varying: m.family?.varying_parameter ?? null,
        is_canonical_family: readFamilyCanonical(m.props),
        updated_at: m.updated_at.toISOString(),
      };
      }),
    });
  } catch (err) {
    console.error('[powerbi/models GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
