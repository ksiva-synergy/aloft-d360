/**
 * scripts/inspector/verify-dashboard-connection-backfill.ts
 *
 * Phase 0 / DEC-1 pre-flight for the platform_dashboards.connection_id backfill.
 *
 * Purpose: confirm that whatever we backfill dashboards with is EXACTLY the
 * connection resolveToolCatalogEntry('') resolves today, so that once Phase 1
 * wires up connection-based reads, execution behaviour stays stable instead of
 * silently shifting to a different warehouse.
 *
 * It does NOT write anything. It:
 *   1. Calls the REAL resolveToolCatalogEntry('') (the runtime source of truth)
 *      and prints the connection id it resolves to.
 *   2. Flags divergence risks (duplicate 'synergy_dwh' rows → non-deterministic
 *      LIMIT 1; resolved catalog row not type='db_query'; resolved connection
 *      missing/inactive; the connection's org differs from a dashboard's org).
 *   3. Reports how many live dashboards would be backfilled and to what.
 *
 * Run AFTER step 01 (connection_id String? added + `npx prisma generate`) and
 * BEFORE the backfill UPDATE — it reads platform_dashboards.connection_id, so
 * the column and generated client must already exist. Run it against the same
 * DATABASE_URL you will run the backfill against (i.e. the non-prod copy first).
 *
 * Read-only: issues only SELECT/count queries, never writes.
 *
 * Run:  npx tsx scripts/inspector/verify-dashboard-connection-backfill.ts
 */
import prisma from '@/lib/db';
import { resolveToolCatalogEntry } from '@/lib/inspector/tools';

async function main() {
  console.log('=== DEC-1 backfill pre-flight ===\n');

  // 1. Source of truth: what the app resolves today for the global default.
  const entry = await resolveToolCatalogEntry('');
  if (!entry) {
    console.error('resolveToolCatalogEntry(\'\') returned null — no default tool resolves today.');
    console.error('Dashboards have no working default connection to backfill from. STOP.');
    process.exitCode = 1;
    return;
  }

  const cfg = (entry.config ?? {}) as Record<string, unknown>;
  const canonicalConnectionId = typeof cfg.connection_id === 'string' ? cfg.connection_id : null;

  console.log('Resolved tool_catalog entry:');
  console.log(`  id=${entry.id} slug=${entry.slug} type=${entry.type} status=${entry.status}`);
  console.log(`  config.connection_id=${canonicalConnectionId ?? '(none)'}\n`);

  if (entry.type !== 'db_query') {
    console.warn(`WARNING: resolved entry is type='${entry.type}', not 'db_query'. `
      + `executeInspectorTool would ERROR on this today — dashboards do not actually `
      + `execute against it. Backfilling from it would encode a connection nothing uses.`);
  }
  if (!canonicalConnectionId) {
    console.error('Resolved entry has no config.connection_id — nothing to backfill with. STOP.');
    process.exitCode = 1;
    return;
  }

  // 2a. Divergence risk: duplicate 'synergy_dwh' rows make the runtime's
  //     slug-only `LIMIT 1` (no ORDER BY) non-deterministic. If >1, a pure-SQL
  //     backfill could pick a different row than this run did.
  const dupes = await prisma.$queryRaw<Array<{ id: string; type: string | null; connection_id: string | null }>>`
    SELECT id::text AS id, type, config->>'connection_id' AS connection_id
    FROM tool_catalog WHERE slug = 'synergy_dwh'`;
  console.log(`'synergy_dwh' rows in tool_catalog: ${dupes.length}`);
  for (const d of dupes) console.log(`  - id=${d.id} type=${d.type} connection_id=${d.connection_id}`);
  const distinctConns = new Set(dupes.map((d) => d.connection_id));
  if (dupes.length > 1 && distinctConns.size > 1) {
    console.warn('WARNING: multiple \'synergy_dwh\' rows point at DIFFERENT connections. '
      + 'The runtime LIMIT 1 is non-deterministic here — do NOT use a pure-SQL subquery '
      + 'backfill. Backfill from the literal id printed below instead.');
  }
  console.log('');

  // 2b. Confirm the resolved connection actually exists and is active.
  const conn = await prisma.platformDatabricksConnection.findUnique({
    where: { id: canonicalConnectionId },
  });
  if (!conn) {
    console.error(`Resolved connection_id ${canonicalConnectionId} not found in `
      + `platform_databricks_connections. STOP.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Target connection: id=${conn.id} name=${conn.name} status=${conn.status} org_id=${conn.org_id}\n`);

  // 3. Backfill scope + cross-org check. tool_catalog is global (no org_id) so
  //    every live dashboard would get this single connection. Flag dashboards
  //    whose org differs from the connection's org — legal today (chat ignores
  //    dashboard org for the global default) but worth an explicit look before
  //    encoding it per-dashboard.
  //
  //    Raw SQL is used for all three counts so this script runs correctly both
  //    before step 01 (connection_id column not yet in generated Prisma client)
  //    and after (column exists). $queryRaw bypasses the client-level schema check.
  const [liveRow] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM platform_dashboards WHERE deleted_at IS NULL`;
  const live = Number(liveRow.n);

  // connection_id column may not exist yet; catch and treat all rows as NULL.
  let nullConn: number;
  try {
    const [nullRow] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM platform_dashboards
      WHERE deleted_at IS NULL AND connection_id IS NULL`;
    nullConn = Number(nullRow.n);
  } catch {
    nullConn = live; // column absent → every row would be backfilled
  }

  const [crossOrgRow] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM platform_dashboards
    WHERE deleted_at IS NULL AND org_id <> ${conn.org_id}`;
  const crossOrg = Number(crossOrgRow.n);

  console.log(`Live dashboards: ${live}  (would-backfill / connection_id IS NULL: ${nullConn})`);
  if (crossOrg > 0) {
    console.warn(`WARNING: ${crossOrg} live dashboard(s) belong to a different org than the `
      + `resolved connection (${conn.org_id}). This matches today's behaviour (the global `
      + `default ignores dashboard org), but confirm it's intended before pinning it.`);
  }

  console.log('\n=== Backfill this value (faithful by construction) ===');
  console.log(`UPDATE platform_dashboards SET connection_id = '${canonicalConnectionId}'`);
  console.log(`WHERE connection_id IS NULL AND deleted_at IS NULL;`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
