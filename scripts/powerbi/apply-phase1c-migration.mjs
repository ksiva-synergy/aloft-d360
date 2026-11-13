/**
 * Apply Power BI Phase 1c catalog-link migration (operator).
 *
 *   node scripts/powerbi/apply-phase1c-migration.mjs
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = 'prisma/migrations/20261113_powerbi_bridge_phase1c_catalog/migration.sql';
const name = '20261113_powerbi_bridge_phase1c_catalog';

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
}

try {
  run(`node scripts/db/prisma-rds-retry.mjs db execute --file ${migration} --schema ./prisma/schema.prisma`);
  run(`node scripts/db/prisma-rds-retry.mjs migrate resolve --applied ${name}`);
  run('npx prisma generate --schema=./prisma/schema.prisma');
  console.log('[apply-phase1c-migration] done');
} catch {
  console.error('[apply-phase1c-migration] failed (apply 1a/1b first)');
  process.exit(1);
}
