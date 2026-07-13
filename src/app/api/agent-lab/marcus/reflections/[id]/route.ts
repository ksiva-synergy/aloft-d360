import { NextRequest, NextResponse } from 'next/server';
import { markDelivered, resolveReflection } from '@/lib/marcus/dal';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case 'delivered':
        await markDelivered(id);
        break;
      case 'dismissed':
      case 'acknowledged':
      case 'acted':
        await resolveReflection(id, action);
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[marcus/reflections/:id PATCH] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
