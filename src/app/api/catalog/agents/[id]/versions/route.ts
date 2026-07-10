import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const entry = await prisma.agent_catalog.findUnique({ where: { id: params.id } });
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    // Walk up to root
    let rootId = entry.id;
    let current: typeof entry = entry;
    const visited = new Set<string>([rootId]);

    while (current.parent_id && !visited.has(current.parent_id)) {
      visited.add(current.parent_id);
      const parent = await prisma.agent_catalog.findUnique({ where: { id: current.parent_id } });
      if (!parent) break;
      rootId = parent.id;
      current = parent;
    }

    // Fetch root + direct children
    const allEntries = await prisma.agent_catalog.findMany({
      select: {
        id: true, name: true, slug: true, version: true, status: true,
        parent_id: true, is_head: true, draft_of_id: true,
        owner_id: true, created_at: true, updated_at: true,
      },
      where: { OR: [{ id: rootId }, { parent_id: rootId }] },
      orderBy: { created_at: 'desc' },
    });

    const ids = allEntries.map(e => e.id);
    let versions = [...allEntries];

    if (ids.length > 0) {
      const children = await prisma.agent_catalog.findMany({
        select: {
          id: true, name: true, slug: true, version: true, status: true,
          parent_id: true, is_head: true, draft_of_id: true,
          owner_id: true, created_at: true, updated_at: true,
        },
        where: { parent_id: { in: ids } },
        orderBy: { created_at: 'desc' },
      });
      const existingIds = new Set(versions.map(v => v.id));
      for (const child of children) {
        if (!existingIds.has(child.id)) versions.push(child);
      }
    }

    return NextResponse.json({ versions, rootId });
  } catch (err) {
    console.error('[catalog/agents/:id/versions GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
