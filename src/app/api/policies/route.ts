import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/catalog-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const type = sp.get('type');
    const scope = sp.get('scope');
    const status = sp.get('status');
    const search = sp.get('search');
    const limit = Math.min(parseInt(sp.get('limit') || '50'), 200);
    const offset = parseInt(sp.get('offset') || '0');

    const data = await prisma.policy_entry.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(scope ? { scope } : {}),
        ...(status ? { status } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: { updated_at: 'desc' },
      skip: offset,
      take: limit,
    });

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    console.error('[policies GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || !body.type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    if (!body.slug) {
      body.slug = slugify(body.name) + '-' + Date.now().toString(36);
    }

    const data = await prisma.policy_entry.create({ data: body });
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'P2002') {
      return NextResponse.json({ error: 'A policy with this slug already exists' }, { status: 409 });
    }
    console.error('[policies POST] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
