import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await prisma.tool_catalog.findMany({
      where: { status: 'active' },
      orderBy: { name: 'asc' },
      take: 100,
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        description: true,
      },
    });
    const tools = rows.map((r) => ({
      id: r.slug ?? r.id,
      name: r.name,
      type: r.type ?? 'tool',
      description: r.description ?? '',
    }));
    return NextResponse.json({ tools });
  } catch (err) {
    console.error('[workbench/tools GET]', err);
    return NextResponse.json({ tools: [] });
  }
}
