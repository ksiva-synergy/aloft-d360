import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { embedQuery } from '@/lib/context/embed';
import { scrubBulletText } from '@/lib/memory/synthesis/scrub';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('retire') }),
  z.object({
    action:   z.literal('edit'),
    ruleText: z.string().min(1).max(500),
  }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = params;

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

  try {
    const org = await getDefaultOrg();

    // Verify bullet exists and belongs to this org
    const existing = await prisma.platformAgentMemory.findFirst({
      where: { id, orgId: org.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const { action } = parsed.data;
    const now = new Date();

    if (action === 'approve') {
      const bullet = await prisma.platformAgentMemory.update({
        where: { id },
        data:  { helpfulCount: { increment: 1 } },
      });
      console.log(`[memory/curate] APPROVE id=${id} helpfulCount=${bullet.helpfulCount}`);
      return NextResponse.json({ bullet });
    }

    if (action === 'retire') {
      const bullet = await prisma.platformAgentMemory.update({
        where: { id },
        data:  { status: 'SUPERSEDED', validUntil: now },
      });
      console.log(`[memory/curate] RETIRE id=${id}`);
      return NextResponse.json({ bullet });
    }

    // action === 'edit'
    const rawText = (parsed.data as { action: 'edit'; ruleText: string }).ruleText;

    // Scrub before re-embedding — same invariant as the synthesis pipeline.
    // COMPLIANCE: PII scrub applied before any write (C4-lite invariant).
    const { scrubbed, redactions, categories } = scrubBulletText(rawText);
    if (redactions > 0) {
      console.warn(
        `[memory/curate/edit] REDACTED ${redactions} pattern(s) before re-embed` +
        ` id=${id} categories=${categories.join(',')}`,
      );
    }

    // Re-embed the scrubbed text via Titan v2
    const vec = await embedQuery(scrubbed);
    if (!vec) {
      return NextResponse.json({ error: 'EMBED_FAILED', details: 'Bedrock Titan embedding returned null' }, { status: 502 });
    }

    const vecStr = `[${vec.join(',')}]`;

    // Prisma cannot bind vector(1024) columns through the ORM — use raw UPDATE.
    // embedText mirrors ruleText for auditability (the text that was actually embedded).
    await prisma.$executeRaw`
      UPDATE platform_agent_memory
      SET rule_text  = ${scrubbed},
          embed_text = ${scrubbed},
          embedding  = ${vecStr}::text::vector,
          updated_at = ${now}
      WHERE id     = ${id}
        AND org_id = ${org.id}
    `;

    const bullet = await prisma.platformAgentMemory.findFirstOrThrow({
      where: { id, orgId: org.id },
    });

    console.log(
      `[memory/curate] EDIT id=${id}` +
      ` rule="${scrubbed.slice(0, 60)}"`,
    );
    return NextResponse.json({ bullet });
  } catch (err) {
    console.error('[memory/curate POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
