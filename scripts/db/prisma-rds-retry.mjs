#!/usr/bin/env node
/**
 * Run `npx prisma …` with retries on transient RDS reachability (P1001).
 * Use when VPN to dev Aurora is flaky.
 *
 *   node scripts/db/prisma-rds-retry.mjs migrate resolve --applied 20261105_data_access
 *   node scripts/db/prisma-rds-retry.mjs db seed
 *
 * Env: PRISMA_RDS_RETRY_ATTEMPTS (default 6), PRISMA_RDS_RETRY_DELAY_MS (default 2500)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prismaArgs = process.argv.slice(2);

if (prismaArgs.length === 0) {
  console.error('Usage: node scripts/db/prisma-rds-retry.mjs <prisma-subcommand> [...args]');
  console.error('Example: node scripts/db/prisma-rds-retry.mjs db seed');
  process.exit(1);
}

const maxAttempts = Math.max(1, Number(process.env.PRISMA_RDS_RETRY_ATTEMPTS ?? 6) || 6);
const delayMs = Math.max(500, Number(process.env.PRISMA_RDS_RETRY_DELAY_MS ?? 2500) || 2500);

function isUnreachableOutput(text) {
  return (
    text.includes('P1001') ||
    text.includes("Can't reach database server") ||
    text.includes('Can\'t reach database server')
  );
}

function runOnce() {
  const hasSchema = prismaArgs.some((a) => a === '--schema' || a.startsWith('--schema='));
  const fullArgs = ['prisma', ...prismaArgs, ...(hasSchema ? [] : ['--schema', './prisma/schema.prisma'])];
  const isWin = process.platform === 'win32';
  // Node ≥ 18.20 / 20.12 refuses to spawn .cmd files without a shell on Windows (EINVAL).
  return spawnSync(isWin ? 'npx.cmd' : 'npx', fullArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    shell: isWin,
  });
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = runOnce();
    if (result.error) {
      console.error(`[prisma-rds-retry] could not start npx prisma: ${result.error.message}`);
      process.exit(1);
    }
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.status === 0) {
      process.exit(0);
    }

    const unreachable = isUnreachableOutput(combined);
    if (!unreachable || attempt >= maxAttempts) {
      process.exit(result.status ?? 1);
    }

    console.warn(
      `[prisma-rds-retry] RDS unreachable (P1001) — attempt ${attempt + 1}/${maxAttempts} in ${delayMs}ms…`,
    );
    await sleep(delayMs);
  }

  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
