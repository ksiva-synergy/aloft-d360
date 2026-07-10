import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await prisma.tool_catalog.findUnique({ where: { id: params.id } });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[catalog/tools/:id GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const immutable = ['id', 'created_at'];
    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const [key, val] of Object.entries(body)) {
      if (!immutable.includes(key) && val !== undefined) updates[key] = val;
    }
    const data = await prisma.tool_catalog.update({ where: { id: params.id }, data: updates });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[catalog/tools/:id PATCH] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await prisma.tool_catalog.update({
      where: { id: params.id },
      data: { status: 'deprecated', updated_at: new Date() },
    });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[catalog/tools/:id DELETE] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
