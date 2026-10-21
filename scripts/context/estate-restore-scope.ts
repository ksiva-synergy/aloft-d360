/**
 * Restore soft-removed discovery rows and optionally widen source scope / run inventory.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/estate-restore-scope.ts \
 *     --source-id <uuid> [--restore] [--widen] [--inventory] [--dry-run]
 */

import prisma from '@/lib/db';
import { runEstateInventory } from '@/lib/context/estate';

const SOURCE_ID = 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';

/** Legacy / JDBC catalogs stewards excluded before widen (re-apply with --restore-excludes). */
const STEWARD_SCOPE_EXCLUDES = [
  '*.information_schema.*',
  '4soldvc1bu_07july2025_catalog.*.*',
  'ba_vims_catalog.*.*',
  'bidfsqldev_catalog.*.*',
  'competency_db.*.*',
  'creworks_catalog.*.*',
  'eyeshare_history_catalog.*.*',
  'eyeshare_sql_catalog.*.*',
  'hive_metastore.*.*',
  'hull_voyage_opt.*.*',
  'mdm_db.*.*',
  'metadata_db.*.*',
  'oceaneye_delta_share.*.*',
  'pg_desktopcentral.*.*',
  'pg_hull_dev_db.*.*',
  'pg_hull_propellor.*.*',
  'pg_hull_saas.*.*',
  'pg_ocean_eye_prod_master_db.*.*',
  'pg_poseidon_db.*.*',
  'pg_poseidon_prod_catalog.*.*',
  'pg_servicedesk.*.*',
  'pg_vsc_prod_catalog.*.*',
  'seaverse_pg_catalog.*.*',
  'shipnet_one_prod.*.*',
  'shipnet_prod_catalog.*.*',
  'sqaudra_db.*.*',
  'staging_db.*.*',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    sourceId: SOURCE_ID,
    restore: false,
    widen: false,
    inventory: false,
    restoreExcludes: false,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--restore') flags.restore = true;
    else if (a === '--widen') flags.widen = true;
    else if (a === '--inventory') flags.inventory = true;
    else if (a === '--restore-excludes') flags.restoreExcludes = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--source-id' && args[i + 1]) {
      flags.sourceId = args[++i];
    }
  }
  if (!flags.restore && !flags.widen && !flags.inventory) {
    flags.restore = true;
    flags.widen = true;
  }
  return flags;
}

async function main() {
  const { sourceId, restore, widen, inventory, restoreExcludes, dryRun } = parseArgs();

  const source = await prisma.platformContextSource.findUnique({
    where: { id: sourceId },
  });
  if (!source) {
    console.error(`Source not found: ${sourceId}`);
    process.exit(1);
  }

  const orgId = source.org_id;
  console.log(`Source: ${source.display_name} (${sourceId}) org=${orgId}`);
  console.log(`scope_include:`, source.scope_include);
  console.log(`scope_exclude:`, source.scope_exclude);

  const counts = await prisma.$queryRawUnsafe<
    { lifecycle: string; cnt: bigint }[]
  >(
    `SELECT lifecycle, COUNT(*)::bigint AS cnt
     FROM platform_estate_objects
     WHERE org_id = $1 AND source_id = $2
     GROUP BY lifecycle
     ORDER BY lifecycle`,
    orgId,
    sourceId,
  );
  console.log('Estate rows by lifecycle:', counts.map(r => ({ lifecycle: r.lifecycle, count: Number(r.cnt) })));

  const totalActive = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    `SELECT COUNT(*)::bigint AS cnt FROM platform_estate_objects
     WHERE org_id = $1 AND lifecycle = 'active'`,
    orgId,
  );
  console.log(`Org-wide active estate objects: ${Number(totalActive[0]?.cnt ?? 0)}`);

  if (dryRun) {
    console.log('[dry-run] No changes applied.');
    return;
  }

  if (restore) {
    const restored = await prisma.$executeRawUnsafe(
      `UPDATE platform_estate_objects
       SET lifecycle = 'active'
       WHERE org_id = $1
         AND source_id = $2
         AND lifecycle = 'removed'`,
      orgId,
      sourceId,
    );
    console.log(`Restored lifecycle=active for ${restored} rows.`);
  }

  if (widen) {
    await prisma.platformContextSource.update({
      where: { id: sourceId },
      data: {
        scope_include: ['*.*.*'],
      },
    });
    console.log('Updated scope_include to ["*.*.*"] (scope_exclude unchanged).');
  }

  if (restoreExcludes) {
    await prisma.platformContextSource.update({
      where: { id: sourceId },
      data: { scope_exclude: STEWARD_SCOPE_EXCLUDES },
    });
    console.log(`Restored ${STEWARD_SCOPE_EXCLUDES.length} scope_exclude patterns.`);
  }

  if (inventory) {
    console.log('Running runEstateInventory (live Databricks)...');
    const stats = await runEstateInventory(sourceId, orgId);
    console.log('Inventory stats:', stats);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
