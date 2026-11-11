import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { getDefaultOrg } from '@/lib/platform/agents';
import { constructionStateSchema } from '@/lib/construction/constructionState';
import { PERMISSIONS } from '@/lib/rbac';
import { workbenchAuth } from '../_auth';
import { parseSurfaceList, surfacesWhere } from '@/lib/sessions/surfaces';
import { hideOtherAdminsAgentChatsWhere } from '@/lib/agents/agent-chats';
import { isAgentConstructionSurface } from '@/lib/inspector/session-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Identity comes only from the server session. Never fall back to a client header.
    const auth = await workbenchAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.userId;
    const artifactType = request.nextUrl.searchParams.get('type');
    const surface = request.nextUrl.searchParams.get('surface');
    const scope = request.nextUrl.searchParams.get('scope'); // 'all' | 'mine'

    // Only platform_admin (session:read:all) may view other users' sessions.
    const canReadAll = auth.permissions.has(PERMISSIONS.SESSION_READ_ALL);
    const wantAll = canReadAll && scope === 'all';
    const adminChatFilter = wantAll ? await hideOtherAdminsAgentChatsWhere(userId) : {};

    // Surface filter: one or a comma list (`?surface=workbench,inspector`); null = workbench for
    // pre-Inspector sessions. No or unknown value = every surface.
    const surfaceFilter = surfacesWhere(parseSurfaceList(surface));

    const data = await prisma.workbench_sessions.findMany({
      select: {
        id: true,
        user_id: true,
        title: true,
        artifact_type: true,
        message_count: true,
        last_message: true,
        pinned: true,
        progress: true,
        saved_agent_id: true,
        modality: true,
        readiness: true,
        surface: true,
        context_mode: true,
        created_at: true,
        updated_at: true,
        _count: { select: { studio_results: true } },
      },
      where: {
        ...(wantAll ? {} : { user_id: userId }),
        ...(artifactType ? { artifact_type: artifactType } : {}),
        ...surfaceFilter,
        ...adminChatFilter,
      },
      orderBy: [{ pinned: 'desc' }, { updated_at: 'desc' }],
      take: wantAll ? 1000 : 200,
    });

    // Resolve user names for all distinct user_ids
    const userIds = [...new Set(data.map(s => s.user_id).filter(Boolean))] as string[];
    const userRows = userIds.length > 0
      ? await prisma.$queryRaw<{ id: string; name: string | null; email: string | null }[]>`
          SELECT id, name, email FROM "User" WHERE id = ANY(${userIds})
        `
      : [];
    const userMap = Object.fromEntries(userRows.map(u => [u.id, u]));

    return NextResponse.json({
      canReadAll,
      scope: wantAll ? 'all' : 'mine',
      sessions: (data ?? []).map(s => ({
        ...s,
        query_result_count: s._count.studio_results,
        _count: undefined,
        user_name: s.user_id ? (userMap[s.user_id]?.name ?? null) : null,
        user_email: s.user_id ? (userMap[s.user_id]?.email ?? null) : null,
      })),
    });
  } catch (err) {
    console.error('[workbench/sessions GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await workbenchAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.userId;
    const body = await request.json();
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (ids.length === 0) return NextResponse.json({ error: 'No ids provided' }, { status: 400 });

    // The caller may delete their own sessions. A platform admin may also delete agent drafts
    // owned by anyone, including another platform admin. Inspector sessions and agent chats stay owner-only.
    const rows = await prisma.workbench_sessions.findMany({
      where: { id: { in: ids } },
      select: { id: true, user_id: true, surface: true },
    });
    const deletableIds = rows
      .filter((row) => row.user_id === userId || (auth.role === 'platform_admin' && isAgentConstructionSurface(row.surface)))
      .map((row) => row.id);
    if (deletableIds.length === 0) return NextResponse.json({ deleted: 0, ids: [] });

    await prisma.$transaction([
      prisma.platform_interaction_search.deleteMany({ where: { session_id: { in: deletableIds } } }),
      prisma.platform_interaction_events.deleteMany({ where: { session_id: { in: deletableIds } } }),
      prisma.workbench_sessions.deleteMany({ where: { id: { in: deletableIds } } }),
    ]);

    return NextResponse.json({ deleted: deletableIds.length, ids: deletableIds });
  } catch (err) {
    console.error('[workbench/sessions DELETE] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const userId = session.user.id;
    const body = await request.json();

    const org = await getDefaultOrg();
    const initialConstructionState = constructionStateSchema.parse({
      memory: { buildContext: { orgId: org.id } },
    });

    const surface =
      typeof body.surface === 'string' && body.surface.trim()
        ? body.surface.trim()
        : 'workbench';
    // Agent chats are created by /api/agent-lab/agents/chat, which links them to their agent.
    if (surface === 'agent_use') {
      return NextResponse.json({ error: 'Agent chats are created by sending a message to the agent' }, { status: 400 });
    }

    const data = await prisma.workbench_sessions.create({
      data: {
        user_id: userId,
        title: body.title || null,
        surface,
        messages: body.messages || [],
        attached_tools: body.attached_tools || [],
        attached_schemas: body.attached_schemas || [],
        attached_agents: body.attached_agents || [],
        draft: body.draft || null,
        artifact_type: body.artifact_type || 'agent',
        artifact_draft: body.artifact_draft || null,
        pinned: body.pinned || false,
        progress: body.progress || null,
        message_count: 0,
        last_message: null,
        construction_state: initialConstructionState as unknown as Prisma.InputJsonValue,
        modality: initialConstructionState.modality ?? null,
        readiness: initialConstructionState.readiness ?? null,
      },
    });

    return NextResponse.json({ session: data }, { status: 201 });
  } catch (err) {
    console.error('[workbench/sessions POST] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
