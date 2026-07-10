import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getObjectAggregate } from '@/lib/context/reads';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'BAD_REQUEST', field: 'id' }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();
    const result = await getObjectAggregate(org.id, id);
    if (!result) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // Safe BigInt serialization for fields like row_count_est and size_bytes_est
    const serialized = JSON.parse(
      JSON.stringify(result, (_, value) =>
        typeof value === 'bigint' ? Number(value) : value
      )
    );

    return NextResponse.json({ data: serialized });
  } catch (err) {
    console.error('[context/objects/:id GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
