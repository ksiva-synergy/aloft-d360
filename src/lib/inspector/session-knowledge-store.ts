import 'server-only';

import { prisma } from '@/lib/db';
import type { TrajectoryEntry } from '@/lib/inspector/agent-loop';
import { generateNarrativeSessionSummary } from '@/lib/inspector/session-knowledge-llm';
import {
  PROGRESS_KEY,
  emptySessionKnowledge,
  formatSessionKnowledgeForPrompt,
  mergeTurnIntoSessionKnowledge,
  parseSessionKnowledge,
  withTemplateSummary,
  type InspectorSessionKnowledge,
} from '@/lib/inspector/session-knowledge-core';

export async function loadSessionKnowledge(sessionId: string): Promise<InspectorSessionKnowledge> {
  try {
    const row = await prisma.workbench_sessions.findUnique({
      where: { id: sessionId },
      select: { progress: true },
    });
    const progress = row?.progress;
    if (!progress || typeof progress !== 'object') return emptySessionKnowledge();
    const raw = (progress as Record<string, unknown>)[PROGRESS_KEY];
    return parseSessionKnowledge(raw);
  } catch {
    return emptySessionKnowledge();
  }
}

export async function saveSessionKnowledge(
  sessionId: string,
  knowledge: InspectorSessionKnowledge,
): Promise<void> {
  const snapshot = withTemplateSummary(knowledge);
  // Atomic jsonb key merge — avoids wiping last_model / other progress keys under concurrent PATCH.
  const result = await prisma.$executeRaw`
    UPDATE workbench_sessions
    SET
      progress = COALESCE(progress, '{}'::jsonb)
        || jsonb_build_object(${PROGRESS_KEY}::text, ${JSON.stringify(snapshot)}::jsonb),
      updated_at = NOW()
    WHERE id = ${sessionId}::uuid
  `;
  if (result === 0) {
    console.warn(`[session-knowledge] save skipped — session ${sessionId} not found yet`);
  }
}

export async function persistSessionKnowledgeAfterTurn(
  sessionId: string,
  trajectory: TrajectoryEntry[],
  meta: {
    userMessage?: string;
    taskGoal?: string;
    assistantExcerpt?: string;
  } = {},
): Promise<void> {
  if (trajectory.length === 0) return;
  try {
    const prev = await loadSessionKnowledge(sessionId);
    const next = mergeTurnIntoSessionKnowledge(prev, trajectory, meta);
    await saveSessionKnowledge(sessionId, next);

    const narrative = await generateNarrativeSessionSummary(next, trajectory, {
      userMessage: meta.userMessage,
      assistantExcerpt: meta.assistantExcerpt,
    });
    if (!narrative) return;

    const withNarrative = withTemplateSummary({
      ...next,
      summaries: {
        template: next.summaries?.template ?? '',
        narrative,
        narrativeUpdatedAt: new Date().toISOString(),
      },
    });
    await saveSessionKnowledge(sessionId, withNarrative);
  } catch (e) {
    console.warn(
      '[session-knowledge] persistSessionKnowledgeAfterTurn failed:',
      e instanceof Error ? e.message : String(e),
    );
  }
}

export async function buildSessionKnowledgeContext(sessionId: string | undefined): Promise<string> {
  if (!sessionId) return '';
  const knowledge = await loadSessionKnowledge(sessionId);
  const fromResults = await loadRecentQueryFacts(sessionId);
  const merged = mergeQueryFactsIntoKnowledge(knowledge, fromResults);
  return formatSessionKnowledgeForPrompt(merged);
}

/** Pull confirmed table paths + last SQL from studio_query_results (survives progress wipe). */
async function loadRecentQueryFacts(sessionId: string): Promise<{
  paths: string[];
  lastSql: string | null;
  heuristics: string[];
}> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ sql: string; row_count: number }>>(
      `SELECT sql, row_count FROM studio_query_results
       WHERE session_id = $1::uuid
       ORDER BY seq DESC
       LIMIT 12`,
      sessionId,
    );
    const paths: string[] = [];
    const heuristics: string[] = [];
    let lastSql: string | null = null;
    for (const r of rows) {
      const sql = typeof r.sql === 'string' ? r.sql : '';
      if (!sql) continue;
      if (!lastSql) lastSql = sql;
      const matches = sql.match(
        /(?:landing_zone(?:_dev)?|curated_db|reporting_layer|raw_db|synergy_dwh)\.[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+/g,
      );
      if (matches) paths.push(...matches.map((p) => p.toLowerCase()));
      if (r.row_count > 0 && sql.toLowerCase().includes('imo')) {
        heuristics.push(
          'Vessel already resolved via IMO filter in a prior successful query — do not re-search catalog for that vessel.',
        );
      }
    }
    if (lastSql) {
      heuristics.push(
        'Prior successful SQL exists for this session — for download/export reuse it via export_query_result (omit statement). Do not restart describe_schema discovery.',
      );
    }
    return { paths: [...new Set(paths)], lastSql, heuristics: [...new Set(heuristics)] };
  } catch {
    return { paths: [], lastSql: null, heuristics: [] };
  }
}

function mergeQueryFactsIntoKnowledge(
  knowledge: InspectorSessionKnowledge,
  facts: { paths: string[]; lastSql: string | null; heuristics: string[] },
): InspectorSessionKnowledge {
  if (facts.paths.length === 0 && !facts.lastSql && facts.heuristics.length === 0) {
    return knowledge;
  }
  const schemaPaths = [...knowledge.schemaPaths];
  for (const p of facts.paths) {
    if (!schemaPaths.some((x) => x.toLowerCase() === p.toLowerCase())) schemaPaths.push(p);
  }
  const heuristics = [...knowledge.heuristics];
  for (const h of facts.heuristics) {
    if (!heuristics.includes(h)) heuristics.push(h);
  }
  if (facts.lastSql) {
    const hint = `Last successful SQL (reuse for export; strip LIMIT server-side):\n${facts.lastSql.slice(0, 1200)}`;
    if (!heuristics.some((h) => h.startsWith('Last successful SQL'))) {
      heuristics.unshift(hint);
    }
  }
  return withTemplateSummary({
    ...knowledge,
    schemaPaths: schemaPaths.slice(0, 48),
    heuristics: heuristics.slice(0, 20),
    updatedAt: new Date().toISOString(),
    task: knowledge.task ?? {
      goal: 'Continue prior Inspector exploration',
      status: 'in_progress',
      nextStep: 'Skip describe_schema rediscovery; use confirmed paths / last SQL above.',
    },
  });
}
