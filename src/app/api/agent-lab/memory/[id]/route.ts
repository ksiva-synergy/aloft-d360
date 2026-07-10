import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = params;

  try {
    const org = await getDefaultOrg();

    const existing = await prisma.platformAgentMemory.findFirst({
      where: { id, orgId: org.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // COMPLIANCE: Hard-delete required by GDPR Art.17 right-to-erasure.
    // This is the single-bullet compliance deletion point (C4-lite invariant).
    // Do NOT convert this to a soft-delete / status transition.
    await prisma.platformAgentMemory.delete({ where: { id } });

    console.log(`[memory/delete] HARD_DELETE id=${id} org=${org.id}`);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[memory/delete DELETE]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
