import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { canCurateBullet, forbidden, requireMemoryCaller } from '@/lib/memory/curation-access';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> },
) {
  const params = await paramsPromise;
  const caller = await requireMemoryCaller(req);
  if (caller instanceof NextResponse) return caller;

  const { id } = params;

  try {
    const org = await getDefaultOrg();

    const existing = await prisma.platformAgentMemory.findFirst({
      where: { id, orgId: org.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (!canCurateBullet(caller, existing)) return forbidden();

    // COMPLIANCE: Hard-delete required by GDPR Art.17 right-to-erasure.
    // This is the single-bullet compliance deletion point (C4-lite invariant).
    // Do NOT convert this to a soft-delete / status transition.
    await prisma.platformAgentMemory.delete({ where: { id } });
    void writeAudit({
      actorId: caller.userId,
      action: 'memory.bullet.deleted',
      entityType: 'platform_agent_memory',
      entityId: id,
      before: { ruleText: existing.ruleText, visibility: existing.visibility, createdBy: existing.createdBy },
    });

    console.log(`[memory/delete] HARD_DELETE id=${id} org=${org.id}`);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[memory/delete DELETE]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
