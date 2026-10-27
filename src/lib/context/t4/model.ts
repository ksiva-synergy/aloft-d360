import 'server-only';
import prisma from '@/lib/db';
import { createId } from '@paralleldrive/cuid2';

const AUTO_BOOTSTRAP_NAME = 'Auto-Bootstrap Model';

export async function ensureAutoBootstrapModel(orgId: string): Promise<string> {
  const existing = await prisma.platform_semantic_models.findFirst({
    where: { org_id: orgId, source_type: 'auto_bootstrap' },
    select: { id: true },
    orderBy: { created_at: 'asc' },
  });
  if (existing) return existing.id;

  const created = await prisma.platform_semantic_models.create({
    data: {
      id: createId(),
      org_id: orgId,
      name: AUTO_BOOTSTRAP_NAME,
      description: 'Semantic model seeded by T4 entity/dimension bootstrap',
      source_type: 'auto_bootstrap',
      status: 'candidate',
    },
    select: { id: true },
  });
  return created.id;
}
