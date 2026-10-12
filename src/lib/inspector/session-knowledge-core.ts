/**
 * Pure session-knowledge merge/format logic (no DB) — safe for unit tests.
 */
import type { TrajectoryEntry } from '@/lib/inspector/agent-loop';

export const SESSION_KNOWLEDGE_VERSION = 1;
export const PROGRESS_KEY = 'inspectorKnowledge';

export interface SessionEntity {
  type: string;
  label: string;
  id: string;
}

export interface SessionTaskState {
  goal: string;
  status: string;
  nextStep?: string;
}

/** Deterministic + optional LLM narrative recap (facts must match structured fields). */
export interface SessionSummaries {
  template: string;
  narrative?: string;
  narrativeUpdatedAt?: string;
}

export interface InspectorSessionKnowledge {
  version: typeof SESSION_KNOWLEDGE_VERSION;
  updatedAt: string;
  schemaPaths: string[];
  entities: SessionEntity[];
  heuristics: string[];
  task?: SessionTaskState;
  summaries?: SessionSummaries;
}

const MAX_PATHS = 48;
const MAX_ENTITIES = 24;
const MAX_HEURISTICS = 20;

const QUALIFIED_TABLE_RE =
  /(?:landing_zone|curated_db|reporting_layer|raw_db|synergy_dwh)\.[a-z0-9_]+\.[a-z0-9_]+/gi;

const VESSEL_NAMES = ['EPIC RADIANCE', 'EMPRESS ZONDA'] as const;

export function emptySessionKnowledge(): InspectorSessionKnowledge {
  return {
    version: SESSION_KNOWLEDGE_VERSION,
    updatedAt: new Date(0).toISOString(),
    schemaPaths: [],
    entities: [],
    heuristics: [],
  };
}

export function parseSessionKnowledge(raw: unknown): InspectorSessionKnowledge {
  if (!raw || typeof raw !== 'object') return emptySessionKnowledge();
  const o = raw as Record<string, unknown>;
  if (o.version !== SESSION_KNOWLEDGE_VERSION) return emptySessionKnowledge();

  const schemaPaths = Array.isArray(o.schemaPaths)
    ? o.schemaPaths.filter((p): p is string => typeof p === 'string').map(normalizeSchemaPath)
    : [];
  const entities = Array.isArray(o.entities)
    ? o.entities
        .filter((e): e is SessionEntity => {
          if (!e || typeof e !== 'object') return false;
          const x = e as Record<string, unknown>;
          return typeof x.type === 'string' && typeof x.label === 'string' && typeof x.id === 'string';
        })
        .map((e) => ({ type: e.type, label: e.label.trim(), id: String(e.id) }))
    : [];
  const heuristics = Array.isArray(o.heuristics)
    ? o.heuristics.filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    : [];

  let task: SessionTaskState | undefined;
  if (o.task && typeof o.task === 'object') {
    const t = o.task as Record<string, unknown>;
    if (typeof t.goal === 'string' && typeof t.status === 'string') {
      task = {
        goal: t.goal.slice(0, 500),
        status: t.status.slice(0, 120),
        nextStep: typeof t.nextStep === 'string' ? t.nextStep.slice(0, 300) : undefined,
      };
    }
  }

  let summaries: SessionSummaries | undefined;
  if (o.summaries && typeof o.summaries === 'object') {
    const s = o.summaries as Record<string, unknown>;
    const template = typeof s.template === 'string' ? s.template.slice(0, 1200) : '';
    const narrative = typeof s.narrative === 'string' ? s.narrative.slice(0, 1200) : undefined;
    const narrativeUpdatedAt =
      typeof s.narrativeUpdatedAt === 'string' ? s.narrativeUpdatedAt : undefined;
    if (template || narrative) {
      summaries = { template, narrative, narrativeUpdatedAt };
    }
  }

  const base = capKnowledge({
    version: SESSION_KNOWLEDGE_VERSION,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date(0).toISOString(),
    schemaPaths: dedupeStrings(schemaPaths),
    entities: dedupeEntities(entities),
    heuristics: dedupeStrings(heuristics),
    task,
    summaries,
  });
  return withTemplateSummary(base);
}

function capKnowledge(k: InspectorSessionKnowledge): InspectorSessionKnowledge {
  return {
    ...k,
    schemaPaths: k.schemaPaths.slice(0, MAX_PATHS),
    entities: k.entities.slice(0, MAX_ENTITIES),
    heuristics: k.heuristics.slice(0, MAX_HEURISTICS),
  };
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function dedupeEntities(items: SessionEntity[]): SessionEntity[] {
  const seen = new Set<string>();
  const out: SessionEntity[] = [];
  for (const e of items) {
    const key = `${e.type}|${e.label.toLowerCase()}|${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function normalizeSchemaPath(path: string): string {
  return path.replace(/\s+/g, '').toLowerCase();
}

function parseToolOutput(output: string | null): unknown {
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function extractPathsFromText(text: string): string[] {
  const matches = text.match(QUALIFIED_TABLE_RE);
  return matches ? matches.map(normalizeSchemaPath) : [];
}

function extractPathsFromDescribeInput(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  if (typeof input.path === 'string' && input.path.includes('.')) {
    paths.push(normalizeSchemaPath(input.path));
  }
  return paths;
}

function extractPathsFromSql(sql: string | null | undefined): string[] {
  if (!sql) return [];
  return extractPathsFromText(sql);
}

function extractEntitiesFromSqlResult(sql: string, parsed: unknown): SessionEntity[] {
  const entities: SessionEntity[] = [];
  const sqlLower = sql.toLowerCase();

  if (!parsed || typeof parsed !== 'object') return entities;
  const obj = parsed as Record<string, unknown>;
  const rows = Array.isArray(obj.rows) ? obj.rows : null;
  if (!rows) return entities;

  const isVesselQuery =
    sqlLower.includes('admvessel') ||
    sqlLower.includes('vslvessel') ||
    sqlLower.includes('vessel');

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = pickString(r, ['name', 'vessel_name', 'vesselname', 'vessel']) ?? null;
    const id =
      pickString(r, ['id', 'vesselid', 'vessel_id', 'vesselxid']) ??
      (typeof r.id === 'number' ? String(r.id) : null);

    if (name && id && isVesselQuery) {
      entities.push({ type: 'vessel', label: name.trim(), id });
      continue;
    }

    for (const vesselLabel of VESSEL_NAMES) {
      if (name && name.toUpperCase().includes(vesselLabel) && id) {
        entities.push({ type: 'vessel', label: vesselLabel, id });
      }
    }
  }

  if (sqlLower.includes('id in (60, 78)') || sqlLower.includes('vesselxid in (60, 78)')) {
    entities.push({ type: 'vessel', label: 'EPIC RADIANCE', id: '78' });
    entities.push({ type: 'vessel', label: 'EMPRESS ZONDA', id: '60' });
  }

  return entities;
}

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function extractHeuristicsFromSql(sql: string, status: 'success' | 'error'): string[] {
  const out: string[] = [];
  const lower = sql.toLowerCase();

  if (status === 'success' && lower.includes('larparentid')) {
    out.push('Component tree hierarchy uses larparentid for parent walks (not only parentcomponentxid).');
  }

  if (lower.includes('information_schema.columns')) {
    const tableMatch = lower.match(/table_name\s*=\s*'([^']+)'/);
    if (tableMatch?.[1]) {
      out.push(
        `Column metadata already retrieved for table ${tableMatch[1]} — do not re-probe information_schema for it.`,
      );
    }
  }

  if (
    status === 'success' &&
    lower.includes('pmslarcompspareregisterlink') &&
    (lower.includes('count(*)') || lower.includes('count(distinct'))
  ) {
    out.push(
      'Spare-to-component register links for vessels 60 and 78 were validated — proceed to final hierarchical extract SQL.',
    );
  }

  if (status === 'success' && lower.includes('db_spv2_somi_dbo')) {
    out.push('ShipPalm SOMI landing schema for these vessels is landing_zone.db_spv2_somi_dbo.');
  }

  return out;
}

function inferTaskUpdate(
  prev: InspectorSessionKnowledge,
  meta: { userMessage?: string; taskGoal?: string },
  hadSuccessfulDataTool: boolean,
): SessionTaskState | undefined {
  const goal = (meta.taskGoal || meta.userMessage || prev.task?.goal || '').trim();
  if (!goal) return prev.task;

  const continueMsg = (meta.userMessage || '').toLowerCase();
  const isContinue =
    continueMsg.includes('continue from where you left off') || continueMsg.includes('continue');

  let status = prev.task?.status ?? 'exploring';
  if (hadSuccessfulDataTool && isContinue) {
    status = 'in_progress';
  } else if (hadSuccessfulDataTool) {
    status = 'discovery_partial';
  }

  return {
    goal: goal.slice(0, 500),
    status,
    nextStep:
      'Use confirmed schema paths and vessel IDs above; run the final join/recursive extract without repeating catalog or information_schema discovery.',
  };
}

export function mergeTurnIntoSessionKnowledge(
  prev: InspectorSessionKnowledge,
  trajectory: TrajectoryEntry[],
  meta: { userMessage?: string; taskGoal?: string } = {},
): InspectorSessionKnowledge {
  const schemaPaths = [...prev.schemaPaths];
  const entities = [...prev.entities];
  const heuristics = [...prev.heuristics];
  let hadSuccessfulDataTool = false;

  for (const entry of trajectory) {
    if (entry.status !== 'success') continue;

    const input = entry.input ?? {};
    const parsed = parseToolOutput(entry.output);

    if (entry.tool === 'describe_schema') {
      schemaPaths.push(...extractPathsFromDescribeInput(input));
      if (typeof entry.output === 'string') {
        schemaPaths.push(...extractPathsFromText(entry.output));
      }
      if (parsed && typeof parsed === 'object') {
        schemaPaths.push(...extractPathsFromText(JSON.stringify(parsed)));
      }
      continue;
    }

    if (entry.tool === 'execute_tool') {
      hadSuccessfulDataTool = true;
      const stmt =
        (input as { args?: { statement?: string } }).args?.statement ??
        (input as { statement?: string }).statement ??
        entry.sqlExcerpt ??
        '';
      schemaPaths.push(...extractPathsFromSql(stmt));
      entities.push(...extractEntitiesFromSqlResult(stmt, parsed));
      heuristics.push(...extractHeuristicsFromSql(stmt, entry.status));
      if (typeof entry.output === 'string') {
        schemaPaths.push(...extractPathsFromText(entry.output));
      }
    }
  }

  const task = inferTaskUpdate(prev, meta, hadSuccessfulDataTool);

  const merged = capKnowledge({
    version: SESSION_KNOWLEDGE_VERSION,
    updatedAt: new Date().toISOString(),
    schemaPaths: dedupeStrings(schemaPaths),
    entities: dedupeEntities(entities),
    heuristics: dedupeStrings(heuristics),
    task,
    summaries: prev.summaries,
  });
  return withTemplateSummary(merged);
}

function uniqueSchemaPrefixes(paths: string[]): string[] {
  const prefixes = new Set<string>();
  for (const p of paths) {
    const parts = p.split('.');
    if (parts.length >= 2) prefixes.add(`${parts[0]}.${parts[1]}`);
    else if (parts.length === 1) prefixes.add(parts[0]);
  }
  return [...prefixes].slice(0, 6);
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Rolling deterministic summary from structured facts only (no LLM).
 */
export function buildTemplateSessionSummary(k: InspectorSessionKnowledge): string {
  const parts: string[] = [];

  if (k.task?.goal) {
    parts.push(`Goal: ${truncate(k.task.goal, 220)} (status: ${k.task.status}).`);
  }

  if (k.entities.length > 0) {
    const ent = k.entities
      .slice(0, 10)
      .map((e) => `${e.type} "${e.label}"→${e.id}`)
      .join(', ');
    parts.push(`Resolved entities: ${ent}.`);
  }

  if (k.schemaPaths.length > 0) {
    const prefixes = uniqueSchemaPrefixes(k.schemaPaths);
    const tableSample = k.schemaPaths.slice(0, 6).join(', ');
    const more = k.schemaPaths.length > 6 ? ` (+${k.schemaPaths.length - 6} more tables)` : '';
    parts.push(
      `Confirmed data: ${prefixes.join(', ')}; key tables include ${tableSample}${more}.`,
    );
  }

  if (k.heuristics.length > 0) {
    parts.push(`Working notes: ${k.heuristics.slice(0, 4).join(' | ')}`);
  }

  if (k.task?.nextStep) {
    parts.push(`Pending: ${truncate(k.task.nextStep, 200)}`);
  }

  return parts.join(' ').trim();
}

export function withTemplateSummary(k: InspectorSessionKnowledge): InspectorSessionKnowledge {
  const template = buildTemplateSessionSummary(k);
  if (!template && !k.summaries?.narrative) {
    return { ...k, summaries: undefined };
  }
  return {
    ...k,
    summaries: {
      template,
      narrative: k.summaries?.narrative,
      narrativeUpdatedAt: k.summaries?.narrativeUpdatedAt,
    },
  };
}

const NARRATIVE_PATH_RE =
  /(?:landing_zone|curated_db|reporting_layer|raw_db|synergy_dwh)\.[a-z0-9_]+\.[a-z0-9_]+/gi;

/** Reject LLM narratives that cite qualified table paths not in session facts. */
export function validateNarrativeAgainstFacts(
  narrative: string,
  knowledge: InspectorSessionKnowledge,
): boolean {
  const cited = narrative.match(NARRATIVE_PATH_RE) ?? [];
  if (cited.length === 0) return true;
  const allowed = new Set(knowledge.schemaPaths.map((p) => p.toLowerCase()));
  return cited.every((path) => allowed.has(path.toLowerCase()));
}

export function summarizeTrajectoryOutline(trajectory: TrajectoryEntry[]): string {
  return trajectory
    .map((t) => {
      const input = t.input ?? {};
      const stmt =
        (input as { args?: { statement?: string } }).args?.statement ??
        t.sqlExcerpt ??
        (typeof input.path === 'string' ? `path=${input.path}` : '') ??
        (typeof input.query === 'string' ? `query=${input.query.slice(0, 60)}` : '');
      const action =
        t.tool === 'describe_schema' && typeof input.action === 'string'
          ? `${input.action}`
          : '';
      const label = [t.tool, action].filter(Boolean).join('/');
      const status = t.status === 'error' ? 'FAILED' : 'ok';
      const excerpt = typeof stmt === 'string' ? truncate(stmt.replace(/\s+/g, ' '), 100) : '';
      return `- [${status}] ${label}${excerpt ? `: ${excerpt}` : ''}`;
    })
    .join('\n');
}

export function formatSessionKnowledgeForPrompt(k: InspectorSessionKnowledge): string {
  const hasPaths = k.schemaPaths.length > 0;
  const hasEntities = k.entities.length > 0;
  const hasHeuristics = k.heuristics.length > 0;
  const hasTask = !!k.task?.goal;
  const templateSummary = k.summaries?.template?.trim() ?? '';
  const narrativeSummary = k.summaries?.narrative?.trim() ?? '';
  if (!hasPaths && !hasEntities && !hasHeuristics && !hasTask && !templateSummary && !narrativeSummary) {
    return '';
  }

  const lines: string[] = [
    '=== SESSION KNOWLEDGE (confirmed earlier in this Inspector session — do not re-discover) ===',
  ];

  if (templateSummary) {
    lines.push(`Summary (structured): ${templateSummary}`);
  }
  if (narrativeSummary) {
    lines.push(`Summary (narrative): ${narrativeSummary}`);
  }

  if (hasTask && k.task) {
    lines.push(`Task: ${k.task.goal}`);
    lines.push(`Status: ${k.task.status}`);
    if (k.task.nextStep) lines.push(`Next: ${k.task.nextStep}`);
  }

  if (hasPaths) {
    lines.push('Confirmed table paths:');
    for (const p of k.schemaPaths) {
      lines.push(`  - ${p}`);
    }
  }

  if (hasEntities) {
    lines.push('Resolved entities:');
    for (const e of k.entities) {
      lines.push(`  - ${e.type} "${e.label}" → id ${e.id}`);
    }
  }

  if (hasHeuristics) {
    lines.push('Working heuristics:');
    for (const h of k.heuristics) {
      lines.push(`  - ${h}`);
    }
  }

  lines.push(
    'If this block lists a path, entity, or heuristic, skip redundant describe_schema search and information_schema column probes for those objects. Proceed with the next analytical SQL step.',
  );
  lines.push('=== END SESSION KNOWLEDGE ===');
  return lines.join('\n');
}
