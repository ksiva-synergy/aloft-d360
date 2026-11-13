/**
 * Apply Power BI Phase 3 translations migration.
 *
 *   node scripts/powerbi/apply-phase3-translate-migration.mjs
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = 'prisma/migrations/20261113_powerbi_bridge_phase3_translate/migration.sql';
const name = '20261113_powerbi_bridge_phase3_translate';

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
}

try {
  run(`node scripts/db/prisma-rds-retry.mjs db execute --file ${migration} --schema ./prisma/schema.prisma`);
  run(`node scripts/db/prisma-rds-retry.mjs migrate resolve --applied ${name}`);
  try {
    run('node scripts/db/prisma-generate.mjs');
  } catch {
    console.error('[apply-phase3-translate-migration] run: node scripts/db/prisma-generate.mjs --stop-dev');
    process.exit(1);
  }
  console.log('[apply-phase3-translate-migration] done');
} catch {
  console.error('[apply-phase3-translate-migration] failed');
  process.exit(1);
}
