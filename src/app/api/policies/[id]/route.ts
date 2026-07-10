import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await prisma.policy_entry.findUnique({ where: { id: params.id } });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[policies/:id GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const mutable = ['name', 'type', 'scope', 'scope_id', 'config', 'enforcement', 'status'];
    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const key of mutable) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    const data = await prisma.policy_entry.update({ where: { id: params.id }, data: updates });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[policies/:id PATCH] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await prisma.policy_entry.update({
      where: { id: params.id },
      data: { status: 'disabled', updated_at: new Date() },
    });
    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('[policies/:id DELETE] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
