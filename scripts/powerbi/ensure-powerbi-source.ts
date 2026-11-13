/**
 * Create dev Power BI platform_context_sources row when missing (CLI / pilot).
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/ensure-powerbi-source.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';

function loadPilotWorkspace(): string {
  const file = path.join(process.cwd(), 'eval', 'powerbi', 'cii-pilot-five-reports.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { workspace_id?: string };
  return raw.workspace_id?.trim() ?? '0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd';
}

async function main(): Promise<void> {
  const orgId = getDefaultOrg().id;
  const tenantId = process.env.PBI_TENANT_ID?.trim();
  if (!tenantId) {
    throw new Error('PBI_TENANT_ID is not set in the environment');
  }

  const existing = await prisma.platformContextSource.findFirst({
    where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' },
    orderBy: { created_at: 'desc' },
  });
  if (existing) {
    console.log(JSON.stringify({ id: existing.id, display_name: existing.display_name, status: 'existing' }));
    return;
  }

  const workspaceId = loadPilotWorkspace();
  const created = await prisma.platformContextSource.create({
    data: {
      org_id: orgId,
      connection_kind: 'powerbi',
      connection_ref: tenantId,
      display_name: 'Power BI (CII pilot)',
      scope_include: [workspaceId],
      scope_exclude: [],
      status: 'active',
    },
  });
  console.log(JSON.stringify({ id: created.id, display_name: created.display_name, status: 'created' }));
}

main()
  .catch(err => {
    console.error('[ensure-powerbi-source]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
