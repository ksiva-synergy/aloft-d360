import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { flattenPermissions, userAuthInclude, PERMISSIONS } from '@/lib/rbac';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    // Require inspector:use (or session:write) — blocks readonly users from creating sessions.
    const userId = session.user.id;
    const dbUser = await prisma.user.findUnique({ where: { id: userId }, include: userAuthInclude });
    const permissions = dbUser ? flattenPermissions(dbUser) : new Set<string>();
    if (!permissions.has(PERMISSIONS.INSPECTOR_USE) && !permissions.has(PERMISSIONS.SESSION_WRITE)) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Inspector access requires member role or above' }, { status: 403 });
    }

    const body = await request.json() as { title?: string; surface?: string; context_mode?: string };

    const data = await prisma.workbench_sessions.create({
      data: {
        user_id: userId,
        title: body.title || null,
        messages: [] as unknown as Prisma.InputJsonValue,
        attached_tools: [] as unknown as Prisma.InputJsonValue,
        attached_schemas: [] as unknown as Prisma.InputJsonValue,
        attached_agents: [] as unknown as Prisma.InputJsonValue,
        artifact_type: 'agent',
        pinned: false,
        message_count: 0,
        last_message: null,
        surface: body.surface ?? 'inspector',
        context_mode: body.context_mode ?? null,
      },
    });

    return NextResponse.json({ session: data }, { status: 201 });
  } catch (err) {
    console.error('[inspector/sessions POST] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
