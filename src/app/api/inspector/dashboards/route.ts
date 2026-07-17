import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import {
  getUserByEmail,
  coerceVisibility,
} from '@/lib/dashboards/permissions';
import { resolveToolCatalogEntry } from '@/lib/inspector/tools';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/dashboards
 * Returns dashboards the current user can see.
 *
 * Query params:
 *  ?modelId=...       — filter by semantic model
 *  ?filter=all|mine|shared
 *    all    — everything visible to the user (default)
 *    mine   — dashboards created by the user (owner collaborator row)
 *    shared — dashboards the user is a non-owner collaborator on
 *
 * POST /api/inspector/dashboards
 * Creates a new dashboard and makes the creator the owner collaborator.
 * Body: { modelId: string, name: string, description?: string, visibility?: 'private'|'org'|'shared' }
 */

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get('modelId') ?? undefined;
    const filterParam = searchParams.get('filter') ?? 'all';

    // Resolve current user id (best-effort; fall back to unscoped query)
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    const userId = currentUser?.id ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let where: any;

    if (!userId) {
      // Unauthenticated or user not found — return only org-visible dashboards
      where = {
        org_id: org.id,
        deleted_at: null,
        visibility: { in: ['org', 'shared'] },
        ...(modelId ? { model_id: modelId } : {}),
      };
    } else if (filterParam === 'mine') {
      where = {
        org_id: org.id,
        deleted_at: null,
        platform_dashboard_collaborators: {
          some: { user_id: userId, role: 'owner' },
        },
        ...(modelId ? { model_id: modelId } : {}),
      };
    } else if (filterParam === 'shared') {
      where = {
        org_id: org.id,
        deleted_at: null,
        platform_dashboard_collaborators: {
          some: { user_id: userId, role: { not: 'owner' } },
        },
        ...(modelId ? { model_id: modelId } : {}),
      };
    } else {
      // all — everything visible to this user
      where = {
        org_id: org.id,
        deleted_at: null,
        OR: [
          { platform_dashboard_collaborators: { some: { user_id: userId } } },
          { visibility: 'org' },
          { visibility: 'shared' },
        ],
        ...(modelId ? { model_id: modelId } : {}),
      };
    }

    const dashboards = await prisma.platform_dashboards.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      include: {
        platform_dashboard_versions_platform_dashboards_current_version_idToplatform_dashboard_versions: {
          select: { widgets: true },
        },
        platform_dashboard_collaborators: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    const result = dashboards.map((d) => {
      const version = d.platform_dashboard_versions_platform_dashboards_current_version_idToplatform_dashboard_versions;
      const widgetCount = version
        ? (Array.isArray(version.widgets) ? version.widgets.length : 0)
        : 0;

      // Find the owner collaborator for display
      const ownerCollab = d.platform_dashboard_collaborators.find((c) => c.role === 'owner');
      const collaboratorCount = d.platform_dashboard_collaborators.length;

      // Effective role for the requesting user
      const myCollab = userId
        ? d.platform_dashboard_collaborators.find((c) => c.user_id === userId)
        : null;
      const myRole = myCollab
        ? myCollab.role
        : (d.visibility === 'org' || d.visibility === 'shared') ? 'org_member' : null;

      const {
        platform_dashboard_versions_platform_dashboards_current_version_idToplatform_dashboard_versions: _v,
        platform_dashboard_collaborators: _c,
        ...rest
      } = d;

      return {
        ...rest,
        widget_count: widgetCount,
        collaborator_count: collaboratorCount,
        owner: ownerCollab?.user ?? null,
        my_role: myRole,
      };
    });

    return NextResponse.json({ dashboards: result });
  } catch (err) {
    console.error('[dashboards GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const org = await getDefaultOrg();
    const body = await request.json() as {
      modelId?: string;
      name: string;
      description?: string;
      visibility?: string;
    };

    if (!body.name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 },
      );
    }

    // Resolve the semantic model. Callers may pass an explicit modelId; when
    // omitted we fall back to the org's governed model — the same one the
    // Inspector chat binds to (see buildSemanticContext). This spares the UI
    // from having to know a cuid up front.
    const model = body.modelId
      ? await prisma.platform_semantic_models.findFirst({
          where: { id: body.modelId, org_id: org.id },
        })
      : await prisma.platform_semantic_models.findFirst({
          where: { org_id: org.id, status: 'governed' },
          orderBy: { created_at: 'desc' },
        });
    if (!model) {
      return NextResponse.json(
        {
          error: body.modelId
            ? 'Model not found'
            : 'No governed semantic model exists for this org yet',
        },
        { status: 404 },
      );
    }
    const modelId = model.id;

    // Resolve creator — SEC-2: actor comes from the session, never the body.
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    const actor = currentUser?.email ?? 'system';

    const id = createId();
    const visibility = coerceVisibility(body.visibility);

    // DEC-1: dashboards bind a Databricks connection at creation (connection_id
    // is NOT NULL). Resolve it the same way the Inspector chat does — the
    // tool_catalog 'synergy_dwh' entry's config.connection_id points at a
    // platform_databricks_connections row. This is what the Phase 0 backfill used.
    const catalogEntry = await resolveToolCatalogEntry('synergy_dwh');
    const connectionId =
      (catalogEntry?.config as Record<string, unknown> | null)?.connection_id;
    if (typeof connectionId !== 'string' || !connectionId) {
      return NextResponse.json(
        { error: 'No Databricks connection is configured for dashboards' },
        { status: 500 },
      );
    }

    const dashboard = await prisma.platform_dashboards.create({
      data: {
        id,
        org_id: org.id,
        model_id: modelId,
        name: body.name,
        description: body.description ?? null,
        created_by: actor,
        visibility,
        connection_id: connectionId,
        current_version_id: null,
        deleted_at: null,
      },
    });

    // Audit: create
    await prisma.platform_dashboard_audit.create({
      data: {
        id: createId(),
        org_id: org.id,
        dashboard_id: id,
        action: 'create',
        version_id: null,
        actor,
      },
    });

    // Auto-create owner collaborator row for the creator (if user exists in DB)
    if (currentUser) {
      await prisma.platform_dashboard_collaborators.create({
        data: {
          id: createId(),
          dashboard_id: id,
          user_id: currentUser.id,
          role: 'owner',
          granted_by: currentUser.id,
        },
      });
    }

    return NextResponse.json({ dashboard }, { status: 201 });
  } catch (err) {
    console.error('[dashboards POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
