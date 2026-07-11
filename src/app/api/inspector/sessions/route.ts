import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? request.headers.get('x-user-id') ?? 'anonymous';
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
