/**
 * Apply Power BI translation rule registry (pbi_translation_rules) migration.
 *
 *   node scripts/powerbi/apply-pbi-rules-migration.mjs
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = 'prisma/migrations/20261114_pbi_translation_rules/migration.sql';
const name = '20261114_pbi_translation_rules';

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
    console.error('[apply-pbi-rules-migration] run: node scripts/db/prisma-generate.mjs --stop-dev');
    process.exit(1);
  }
  console.log('[apply-pbi-rules-migration] done');
} catch {
  console.error('[apply-pbi-rules-migration] failed');
  process.exit(1);
}
