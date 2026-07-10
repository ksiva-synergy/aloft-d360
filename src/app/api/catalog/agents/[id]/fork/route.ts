import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const original = await prisma.agent_catalog.findUnique({ where: { id: params.id } });
    if (!original) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));

    const data = await prisma.agent_catalog.create({
      data: {
        name: body.name || `${original.name} (fork)`,
        slug: `${original.slug}-fork-${Date.now().toString(36)}`,
        type: original.type,
        description: original.description,
        version: body.version || original.version,
        config: original.config ?? {},
        tools: original.tools ?? [],
        input_schema: original.input_schema ?? {},
        output_schema: original.output_schema ?? {},
        bus_subscriptions: original.bus_subscriptions ?? [],
        bus_publications: original.bus_publications ?? [],
        tags: original.tags ?? [],
        status: 'draft',
        author: body.author || original.author,
        parent_id: params.id,
        is_head: false,
        draft_of_id: body.draft_of_id || null,
        owner_id: body.owner_id || null,
        reviewers: [],
        policy_ids: original.policy_ids ?? [],
      },
    });

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err) {
    console.error('[catalog/agents/:id/fork POST] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
