/**
 * Run a scoped Power BI harvest locally (5-report pilot) before Fargate.
 *
 * Prerequisites:
 *   - .env with DATABASE_URL, PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET, DEFAULT_ORG_ID
 *   - Active platform_context_sources row (connection_kind=powerbi)
 *   - HARVEST_RUNTIME=local optional if launching from UI; this script runs orchestrator in-process
 *
 * Usage:
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/run-pilot-local.ts --list-reports
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/run-pilot-local.ts --use-cii-pilot-five
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/run-pilot-local.ts \\
 *     --source-id <context-source-uuid> \\
 *     --report-ids <guid>,<guid>,... \\
 *     [--model-ids <pbi_model_guid>,...] \\
 *     [--skip-inventory]
 *     [--from-kind pbi_definitions]   resume after inventory / VPN blip
 *     [--no-llm-cap]                  LLM-translate every UC-bound candidate (max_llm_measures=0)
 *     [--max-llm-measures <n>]        override LLM cap (pilot default 12)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import prisma from '@/lib/db';
import { enqueue, type JobKind } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/org';
import { getPbiTranslateLlmRouting } from '@/lib/powerbi/translate-llm';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function splitCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function listReports(orgId: string): Promise<void> {
  const rows = await prisma.pbiReport.findMany({
    where: { org_id: orgId, lifecycle: 'active' },
    orderBy: { name: 'asc' },
    take: 50,
    select: {
      pbi_report_id: true,
      name: true,
      pbi_model_id: true,
      workspace: { select: { name: true } },
    },
  });
  if (rows.length === 0) {
    console.log('No pbi_reports rows — run pbi_inventory first.');
    return;
  }
  console.log('pbi_report_id | model_id | workspace | name');
  for (const r of rows) {
    console.log(
      `${r.pbi_report_id} | ${r.pbi_model_id ?? '—'} | ${r.workspace?.name ?? '—'} | ${r.name}`,
    );
  }
}

async function resolveModelIdsFromReports(
  orgId: string,
  reportIds: string[],
): Promise<string[]> {
  const rows = await prisma.pbiReport.findMany({
    where: { org_id: orgId, pbi_report_id: { in: reportIds } },
    select: { pbi_model_id: true },
  });
  const ids = [...new Set(rows.map(r => r.pbi_model_id).filter((x): x is string => !!x?.trim()))];
  return ids;
}

async function runChildJob(orgId: string, jobId: string): Promise<void> {
  console.log(`[pilot] in-process orchestrator job ${jobId}`);
  const { runQueuedJobById } = await import('../../scripts/context/orchestrator');
  const result = await runQueuedJobById(orgId, jobId);
  if (result.status === 'failed') {
    throw new Error(result.error ?? `Job ${jobId} failed`);
  }
}

const PIPELINE: JobKind[] = [
  'pbi_inventory',
  'pbi_definitions',
  'pbi_parse',
  'pbi_catalog_link',
  'pbi_domains',
  'pbi_families',
  'pbi_translate',
  'pbi_oracle',
  'pbi_parity',
  'pbi_publish',
];

function loadCiiPilotFive(): { reportIds: string[]; labels: string[] } {
  const file = path.join(
    process.cwd(),
    'eval',
    'powerbi',
    'cii-pilot-five-reports.json',
  );
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    report_ids?: string[];
    report_labels?: string[];
  };
  return {
    reportIds: raw.report_ids ?? [],
    labels: raw.report_labels ?? [],
  };
}

async function resolvePowerBiSourceId(orgId: string): Promise<string> {
  const row = await prisma.platformContextSource.findFirst({
    where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' },
    orderBy: { created_at: 'desc' },
    select: { id: true, display_name: true },
  });
  if (!row) {
    throw new Error('No active powerbi platform_context_sources row — create one in Estate first.');
  }
  console.log(`[pilot] source=${row.id} (${row.display_name ?? 'Power BI'})`);
  return row.id;
}

async function main(): Promise<void> {
  const orgId = getDefaultOrg().id;

  if (hasFlag('--list-reports')) {
    await listReports(orgId);
    return;
  }

  let sourceId = argValue('--source-id');
  let reportIds = splitCsv(argValue('--report-ids'));

  if (hasFlag('--use-cii-pilot-five')) {
    const preset = loadCiiPilotFive();
    reportIds = preset.reportIds;
    console.log(`[pilot] CII pilot reports: ${preset.labels.join(', ')}`);
  }

  if (!sourceId) {
    sourceId = await resolvePowerBiSourceId(orgId);
  }

  if (reportIds.length === 0) {
    console.error(
      'Missing --report-ids or --use-cii-pilot-five. Use --list-reports after inventory.',
    );
    process.exit(1);
  }

  let modelIds = splitCsv(argValue('--model-ids'));
  if (modelIds.length === 0) {
    modelIds = await resolveModelIdsFromReports(orgId, reportIds);
    console.log(`[pilot] resolved model_ids: ${modelIds.join(', ') || '(none — run inventory first)'}`);
  }

  const noLlmCap = hasFlag('--no-llm-cap');
  const maxLlmMeasuresArg = argValue('--max-llm-measures');
  let maxLlmMeasures: number | undefined;
  if (noLlmCap) {
    maxLlmMeasures = 0;
  } else if (maxLlmMeasuresArg !== undefined) {
    const n = Number(maxLlmMeasuresArg);
    if (!Number.isFinite(n) || n < 0) {
      console.error('--max-llm-measures must be a non-negative number (0 = unlimited)');
      process.exit(1);
    }
    maxLlmMeasures = n;
  } else {
    maxLlmMeasures = 12;
  }

  const pilotScope: Record<string, unknown> = {
    report_ids: reportIds,
    model_ids: modelIds.length > 0 ? modelIds : undefined,
    max_reports: reportIds.length,
    max_models: Math.max(modelIds.length, 1),
    fetch_reports: true,
    fetch_models: modelIds.length > 0,
    max_measures_per_model: 8,
    max_llm_measures: maxLlmMeasures,
    /** Oracle runs after translate; snapshot every measure with draft SQL. */
    oracle_only_translated: true,
    pilot: true,
  };

  if (noLlmCap) {
    console.log('[pilot] LLM translate uncapped (max_llm_measures=0)');
  }
  const llmRoute = getPbiTranslateLlmRouting();
  console.log(
    `[pilot] PBI translate LLM provider=${llmRoute.provider} model=${llmRoute.modelId ?? '(default)'}`,
  );

  const skipInventory = hasFlag('--skip-inventory');
  const fromKind = argValue('--from-kind');
  let pipeline = PIPELINE;
  if (fromKind) {
    const idx = PIPELINE.indexOf(fromKind as JobKind);
    if (idx < 0) {
      console.error(`Unknown --from-kind ${fromKind}`);
      process.exit(1);
    }
    pipeline = PIPELINE.slice(idx);
    console.log(`[pilot] resume from ${fromKind} (${pipeline.length} steps)`);
  }

  for (const kind of pipeline) {
    if (kind === 'pbi_inventory' && skipInventory) {
      console.log('[pilot] skip pbi_inventory');
      continue;
    }

    const scope =
      kind === 'pbi_inventory'
        ? { pilot: true, report_ids: reportIds }
        : { ...pilotScope };

    const job = await enqueue(kind, sourceId, scope, 'on_demand', orgId);
    console.log(`[pilot] enqueued ${kind} job=${job.id}`);
    await runChildJob(orgId, job.id);
  }

  console.log('[pilot] done');
}

main()
  .catch(err => {
    console.error('[pilot] failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
