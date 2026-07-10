import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  sessionId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST', details: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  const { sessionId } = parsed.data;

  try {
    const org = await getDefaultOrg();
    const orgId = org.id;

    // ── Pre-flight count logging ──────────────────────────────────────────────
    // Log sizes before we touch anything so that the purge is auditable even
    // if the transaction rolls back.

    const [edgeCount, nodeCount, bulletCount] = await Promise.all([
      prisma.platformTraceEdge.count({ where: { orgId, sessionId } }),
      prisma.platformTraceNode.count({ where: { orgId, sessionId } }),
      prisma.platformAgentMemory.count({
        where: { orgId, sourceSessionIds: { has: sessionId } },
      }),
    ]);

    console.log(
      `[memory/purge-session] STARTING purge org=${orgId} session=${sessionId}` +
      ` edges=${edgeCount} nodes=${nodeCount} affectedBullets=${bulletCount}`,
    );

    // ── Transactional cascade delete ─────────────────────────────────────────
    //
    // Order: edges → nodes → bullets (sole-provenance deleted, multi-source
    // array-scrubbed). All three operations are atomic — if any step throws,
    // the entire purge rolls back and no partial state is committed.
    //
    // Interactive transaction with 30s timeout; sessions with >1 000 nodes are
    // rare and the default 5s limit is insufficient for large purges.

    const result = await prisma.$transaction(
      async (tx) => {
        // Step 1: Delete all trace edges for this session.
        // Edges reference nodes via fromNodeId/toNodeId but there are no Prisma
        // @relation declarations — deletion is application-managed, not cascade.
        const { count: edgesDeleted } = await tx.platformTraceEdge.deleteMany({
          where: { orgId, sessionId },
        });

        // Step 2: Delete all trace nodes for this session.
        const { count: nodesDeleted } = await tx.platformTraceNode.deleteMany({
          where: { orgId, sessionId },
        });

        // Step 3: Resolve affected memory bullets — those that list this session
        // in their sourceSessionIds array.
        const affectedBullets = await tx.platformAgentMemory.findMany({
          where:  { orgId, sourceSessionIds: { has: sessionId } },
          select: { id: true, sourceSessionIds: true },
        });

        const soleProvenance  = affectedBullets.filter(b => b.sourceSessionIds.length === 1);
        const multiSource     = affectedBullets.filter(b => b.sourceSessionIds.length > 1);

        // Step 4a: Hard-delete bullets whose only evidence is this session.
        //
        // COMPLIANCE: Hard-delete required by GDPR Art.17 right-to-erasure
        // (session purge path). Sole-provenance bullets have no independent
        // existence beyond the purged session — retaining them would reconstitute
        // subject data. This is a compliance-required deletion point (C4-lite).
        let bulletsDeleted = 0;
        if (soleProvenance.length > 0) {
          const { count } = await tx.platformAgentMemory.deleteMany({
            where: { id: { in: soleProvenance.map(b => b.id) } },
          });
          bulletsDeleted = count;
        }

        // Step 4b: For bullets derived from multiple sessions, remove this
        // session from the sourceSessionIds array only — the bullet survives
        // because it has independent provenance from other sessions.
        //
        // COMPLIANCE: Array removal satisfies GDPR Art.17 for the contribution
        // of this specific session to a shared rule. The bullet remains linked
        // only to sessions that were NOT purged.
        let bulletsUpdated = 0;
        for (const bullet of multiSource) {
          await tx.platformAgentMemory.update({
            where: { id: bullet.id },
            data:  {
              sourceSessionIds: bullet.sourceSessionIds.filter(s => s !== sessionId),
            },
          });
          bulletsUpdated++;
        }

        return { edgesDeleted, nodesDeleted, bulletsDeleted, bulletsUpdated };
      },
      { timeout: 30_000 },
    );

    console.log(
      `[memory/purge-session] COMPLETE org=${orgId} session=${sessionId}` +
      ` edgesDeleted=${result.edgesDeleted} nodesDeleted=${result.nodesDeleted}` +
      ` bulletsDeleted=${result.bulletsDeleted} bulletsUpdated=${result.bulletsUpdated}`,
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error('[memory/purge-session POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
