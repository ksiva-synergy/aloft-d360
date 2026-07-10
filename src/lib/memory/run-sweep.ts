/**
 * src/lib/memory/run-sweep.ts
 *
 * Core synthesis sweep logic — shared between the CLI script
 * (scripts/memory/synthesize.ts) and the API route
 * (src/app/api/agent-lab/memory/synthesize/route.ts).
 *
 * Scans platform_trace_nodes for sessions newer than the watermark,
 * reflects each through Marcus, and curates the candidates into
 * platform_agent_memory.
 */

import { createId } from '@paralleldrive/cuid2';
import { prisma } from '@/lib/prisma';
import { reflectSession, computeTaskSignature, curate, PROMPT_VERSION } from '@/lib/memory/synthesis';
import { reconstructSession } from '@/lib/memory/trace/reconstruct';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SweepSummary {
  sessionsScanned:    number;
  sessionsReflected:  number;
  sessionsSkipped:    number;
  bulletsInserted:    number;
  bulletsDeduped:     number;
  bulletsSuperseded:  number;
  phantomsBlocked:    number;
  bulletsQuarantined: number;
  errors:             number;
  firstError:         string | null;
}

// ── Watermark ─────────────────────────────────────────────────────────────────

async function getWatermark(orgId: string): Promise<Date> {
  type Row = { max_ts: Date | null };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT MAX(created_at) AS max_ts
    FROM platform_agent_memory
    WHERE org_id = ${orgId} AND status = 'ACTIVE'
  `;
  return rows[0]?.max_ts ?? new Date(0);
}

// ── Already-processed guard ────────────────────────────────────────────────────

async function getProcessedSessionIds(orgId: string): Promise<Set<string>> {
  type Row = { source_session_ids: string[] };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT source_session_ids
    FROM platform_agent_memory
    WHERE org_id = ${orgId} AND status = 'ACTIVE'
  `;
  const processed = new Set<string>();
  for (const row of rows) {
    for (const sid of row.source_session_ids ?? []) processed.add(sid);
  }
  return processed;
}

// ── Per-session exclusion (MEMORY_SYNTH_EXCLUDE_SESSION_IDS stopgap) ──────────
// Comma-separated session IDs to skip from synthesis input.
// Default unset/empty — zero behaviour change when unset.
// ONE-TIME USE: unset this env var after the targeted run completes.

function getExcludedSessionIds(): Set<string> {
  const raw = process.env.MEMORY_SYNTH_EXCLUDE_SESSION_IDS ?? '';
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return new Set(ids);
}

// ── Session discovery ─────────────────────────────────────────────────────────

async function findUnprocessedSessions(
  orgId:            string,
  watermark:        Date,
  alreadyProcessed: Set<string>,
  limit:            number | null,
): Promise<string[]> {
  type Row = { session_id: string };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT DISTINCT session_id
    FROM platform_trace_nodes
    WHERE org_id = ${orgId}
      AND created_at > ${watermark}
    ORDER BY session_id
  `;

  const excluded = getExcludedSessionIds();

  let sessions = rows
    .map(r => r.session_id)
    .filter(sid => !alreadyProcessed.has(sid))
    .filter(sid => !excluded.has(sid));

  if (excluded.size > 0) {
    console.log(`[runSynthesisSweep] MEMORY_SYNTH_EXCLUDE_SESSION_IDS active — excluding ${excluded.size} session(s): ${[...excluded].join(', ')}`);
  }

  if (limit !== null && limit > 0) sessions = sessions.slice(0, limit);
  return sessions;
}

// ── Per-session processor ─────────────────────────────────────────────────────

interface ProcessResult {
  inserted:           number;
  deduped:            number;
  superseded:         number;
  phantomsBlocked:    number;
  quarantined:        number;
  candidatesProduced: number;
  agentClass:         string | null;
  taskSignature:      string | null;
  skippedReason:      string | null;
}

async function processSession(orgId: string, sessionId: string): Promise<ProcessResult> {
  const skipped = (reason: string): ProcessResult => ({
    inserted: 0, deduped: 0, superseded: 0, phantomsBlocked: 0, quarantined: 0,
    candidatesProduced: 0, agentClass: null, taskSignature: null,
    skippedReason: reason,
  });

  const firstNode = await prisma.platformTraceNode.findFirst({
    where:   { orgId, sessionId },
    orderBy: { createdAt: 'asc' },
    select:  { agentClass: true },
  });

  const agentClass = firstNode?.agentClass ?? null;
  if (!agentClass) return skipped('no agentClass on first node');

  const sigResult = await computeTaskSignature(orgId, sessionId);
  if (!sigResult) return skipped('computeTaskSignature returned null');
  const { signature: taskSignature, shortLabel } = sigResult;

  const traceNodes = await reconstructSession(orgId, sessionId);
  const candidates = await reflectSession(orgId, sessionId);

  if (candidates.length === 0) {
    return {
      inserted: 0, deduped: 0, superseded: 0, phantomsBlocked: 0, quarantined: 0,
      candidatesProduced: 0, agentClass, taskSignature,
      skippedReason: 'Reflector returned 0 candidates',
    };
  }

  const curateResult = await curate(
    orgId, sessionId, agentClass, taskSignature, candidates, traceNodes, shortLabel,
  );

  return {
    inserted:           curateResult.inserted,
    deduped:            curateResult.deduped,
    superseded:         curateResult.superseded,
    phantomsBlocked:    curateResult.phantomsBlocked,
    quarantined:        curateResult.quarantined,
    candidatesProduced: candidates.length,
    agentClass,
    taskSignature,
    skippedReason:      null,
  };
}

// ── Main sweep ────────────────────────────────────────────────────────────────

export async function runSynthesisSweep(
  orgId: string,
  limit: number | null = null,
): Promise<SweepSummary> {
  const summary: SweepSummary = {
    sessionsScanned: 0, sessionsReflected: 0, sessionsSkipped: 0,
    bulletsInserted: 0, bulletsDeduped: 0, bulletsSuperseded: 0,
    phantomsBlocked: 0, bulletsQuarantined: 0, errors: 0, firstError: null,
  };

  const runId = createId();
  const startedAt = new Date();
  await prisma.platformMemorySynthesisRun.create({
    data: { id: runId, orgId, startedAt, reflectorVersion: PROMPT_VERSION },
  });

  const watermark       = await getWatermark(orgId);
  const alreadyProcessed = await getProcessedSessionIds(orgId);
  const sessions        = await findUnprocessedSessions(orgId, watermark, alreadyProcessed, limit);
  summary.sessionsScanned = sessions.length;

  for (const sessionId of sessions) {
    let detailData: Omit<
      Parameters<typeof prisma.platformMemorySynthesisDetail.create>[0]['data'],
      'id' | 'orgId' | 'runId'
    > = { sessionId, skippedReason: null, error: null };

    try {
      const result = await processSession(orgId, sessionId);

      detailData = {
        sessionId,
        agentClass:          result.agentClass  ?? undefined,
        taskSignature:       result.taskSignature ?? undefined,
        candidatesProduced:  result.candidatesProduced,
        bulletsInserted:     result.inserted,
        bulletsDeduped:      result.deduped,
        bulletsSuperseded:   result.superseded,
        phantomsBlocked:     result.phantomsBlocked,
        bulletsQuarantined:  result.quarantined,
        skippedReason:       result.skippedReason ?? undefined,
        error:               null,
      };

      if (result.skippedReason) {
        summary.sessionsSkipped++;
      } else {
        summary.sessionsReflected++;
        summary.bulletsInserted    += result.inserted;
        summary.bulletsDeduped     += result.deduped;
        summary.bulletsSuperseded  += result.superseded;
        summary.phantomsBlocked    += result.phantomsBlocked;
        summary.bulletsQuarantined += result.quarantined;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[runSynthesisSweep] ERROR session=${sessionId}:`, msg);
      summary.errors++;
      if (!summary.firstError) summary.firstError = msg;
      detailData = { ...detailData, error: msg };
    }

    await prisma.platformMemorySynthesisDetail.create({
      data: { id: createId(), orgId, runId, ...detailData },
    });
  }

  await prisma.platformMemorySynthesisRun.update({
    where: { id: runId },
    data: {
      completedAt:        new Date(),
      sessionsScanned:    summary.sessionsScanned,
      sessionsReflected:  summary.sessionsReflected,
      sessionsSkipped:    summary.sessionsSkipped,
      bulletsInserted:    summary.bulletsInserted,
      bulletsDeduped:     summary.bulletsDeduped,
      bulletsSuperseded:  summary.bulletsSuperseded,
      phantomsBlocked:    summary.phantomsBlocked,
      bulletsQuarantined: summary.bulletsQuarantined,
      errors:             summary.errors,
      firstError:        summary.firstError ?? undefined,
    },
  });

  return summary;
}
