/**
 * Apply Power BI Phase 1 migration via prisma-rds-retry (operator).
 *
 *   node scripts/powerbi/apply-phase1-migration.mjs
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = 'prisma/migrations/20261111_powerbi_bridge_phase1/migration.sql';
const name = '20261111_powerbi_bridge_phase1';

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
}

try {
  run(`node scripts/db/prisma-rds-retry.mjs db execute --file ${migration} --schema ./prisma/schema.prisma`);
  run(`node scripts/db/prisma-rds-retry.mjs migrate resolve --applied ${name}`);
  run('npx prisma generate --schema=./prisma/schema.prisma');
  console.log('[apply-phase1-migration] done');
} catch (e) {
  console.error('[apply-phase1-migration] failed (VPN/RDS or backup policy?)');
  process.exit(1);
}
