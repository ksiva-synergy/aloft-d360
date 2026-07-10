import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/catalog-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const status = sp.get('status');
    const type = sp.get('type');
    const search = sp.get('search');
    const tag = sp.get('tag');
    const limit = Math.min(parseInt(sp.get('limit') || '50'), 200);
    const offset = parseInt(sp.get('offset') || '0');
    const orderBy = sp.get('orderBy') || 'updated_at';
    const orderDir = sp.get('orderDir') === 'asc' ? 'asc' : 'desc';

    const data = await prisma.tool_catalog.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
      },
      orderBy: { [orderBy]: orderDir },
      skip: offset,
      take: limit,
    });

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    console.error('[catalog/tools GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.name || !body.type) {
      return NextResponse.json({ error: 'Missing required fields: name, type' }, { status: 400 });
    }
    if (!body.slug) {
      body.slug = slugify(body.name) + '-' + Date.now().toString(36);
    }
    const data = await prisma.tool_catalog.create({ data: body });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'An entry with this slug already exists' }, { status: 409 });
    }
    console.error('[catalog/tools POST] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
