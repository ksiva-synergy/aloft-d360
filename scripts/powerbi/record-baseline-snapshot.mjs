/**
 * Record a before/after platform snapshot for Power BI integration validation.
 * No secrets printed. Optional DB counts when DATABASE_URL is set in env.
 *
 * Usage:
 *   node scripts/powerbi/record-baseline-snapshot.mjs --label before-phase1
 *   node --env-file=.env scripts/powerbi/record-baseline-snapshot.mjs --label after-phase1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs() {
  const labelIdx = process.argv.indexOf('--label');
  const label = labelIdx >= 0 ? process.argv[labelIdx + 1] : 'snapshot';
  return { label: label || 'snapshot' };
}

function countFilesUnder(dir, ext) {
  if (!fs.existsSync(dir)) return null;
  let n = 0;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (!ext || ent.name.endsWith(ext)) n++;
    }
  };
  walk(dir);
  return n;
}

function gitInfo() {
  try {
    return {
      branch: execSync('git branch --show-current', { cwd: root, encoding: 'utf8' }).trim(),
      commit: execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim(),
    };
  } catch {
    return { branch: null, commit: null };
  }
}

async function dbCounts() {
  const url = process.env.DATABASE_URL;
  if (!url) return { skipped: 'DATABASE_URL not set' };
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const powerbiSources = await prisma.platformContextSource.count({
      where: { connection_kind: 'powerbi' },
    });
    let pbi = null;
    try {
      const [ws, models, reports, usage] = await Promise.all([
        prisma.pbiWorkspace.count(),
        prisma.pbiModel.count(),
        prisma.pbiReport.count(),
        prisma.pbiUsage.count(),
      ]);
      pbi = { pbi_workspaces: ws, pbi_models: models, pbi_reports: reports, pbi_usage: usage };
    } catch (e) {
      pbi = { error: 'pbi_* tables missing or unreachable', detail: String(e.message || e).slice(0, 200) };
    }
    await prisma.$disconnect();
    return { powerbi_context_sources: powerbiSources, pbi };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 300) };
  }
}

async function main() {
  const { label } = parseArgs();
  const capturedAt = new Date().toISOString();
  const estate = path.join(root, 'powerbi-estate');

  const snapshot = {
    label,
    captured_at: capturedAt,
    git: gitInfo(),
    offline_estate: {
      definitions_tmdl_files: countFilesUnder(path.join(estate, 'definitions'), '.tmdl'),
      report_modern_dirs: fs.existsSync(path.join(estate, 'report-definitions'))
        ? fs.readdirSync(path.join(estate, 'report-definitions'), { withFileTypes: true }).filter((d) => d.isDirectory())
            .length
        : null,
      report_legacy_dirs: fs.existsSync(path.join(estate, 'report-definitions-legacy'))
        ? fs
            .readdirSync(path.join(estate, 'report-definitions-legacy'), { withFileTypes: true })
            .filter((d) => d.isDirectory()).length
        : null,
    },
    database: await dbCounts(),
    notes: [
      'Phase 1 improves platform inventory, not Inspector answers until Phase 3 publish.',
      'Pair with eval/powerbi/suites question bank and compare_cii_pbi_databricks.mjs for technical parity.',
    ],
  };

  const outDir = path.join(root, 'eval', 'powerbi', 'runs');
  fs.mkdirSync(outDir, { recursive: true });
  const safeLabel = label.replace(/[^\w.-]+/g, '_');
  const outFile = path.join(outDir, `${capturedAt.slice(0, 10)}-${safeLabel}-snapshot.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`[record-baseline-snapshot] wrote ${path.relative(root, outFile)}`);
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
