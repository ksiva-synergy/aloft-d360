/**
 * Caveat Guard — session-level caveat map builder and per-bullet severity checker.
 *
 * Called by curate() between the Rama validation gate and embedQuery.
 * Pure read — no writes, no LLM calls. Fast: one SQL query per session.
 *
 * Design decisions implemented (from caveat-guard_design_ce8985aa.plan.md):
 *   D1 — Unresolvable path: silently skipped (no-caveat treatment).
 *   D2 — Per-table suppression: only bullets that explicitly name a HIGH-caveated
 *         path are quarantined; bullets from the same session referencing clean
 *         tables pass through.
 *   D3 — Quarantine (status='QUARANTINED') rather than hard block.
 *   D4 — Called from curate.ts; per-bullet granularity preserved.
 *   D5 — HARD_RULE / FAILURE_MODE / SCHEMA_MAP exempt from quarantine.
 *
 * Flag contract:
 *   MEMORY_CAVEAT_GUARD_ENABLED  — master switch (default 'false')
 *   MEMORY_CAVEAT_GUARD_ORGS     — comma-separated allow-list; empty = no orgs
 *   MEMORY_CAVEAT_GUARD_LEVEL    — 'HIGH' (default) | 'MEDIUM'
 */

import { prisma } from '@/lib/prisma';
import { extractSchemaIdentifiers } from '@/lib/memory/synthesis/validate';
import type { TraceWalkRow } from '@/lib/memory/trace/reconstruct';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CaveatTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CaveatSignal {
  kind:    'structural' | 'semantic';
  tier:    CaveatTier;
  reason:  string;
}

export interface CaveatEntry {
  fullPath: string;
  tier:     CaveatTier;
  signals:  CaveatSignal[];
}

/** Returned from buildSessionCaveatMap: full_path → CaveatEntry for every path
 *  that resolved to a PCO row with at least one caveat signal. Paths with no
 *  signals (clean tables) are absent from the map. Unresolvable paths (no PCO
 *  row) are also absent — D1: silent skip. */
export type CaveatMap = Map<string, CaveatEntry>;

/** What checkBulletCaveat returns: null means "pass through", non-null means quarantine. */
export interface BulletCaveatResult {
  tier:      CaveatTier;
  paths:     string[];          // which paths in the bullet triggered this
  signals:   CaveatSignal[];    // all signals from all triggering paths
}

// ── Regex patterns for Tier 2 semantic card checks ────────────────────────────

/** Tier 2 HIGH — single executor / ad-hoc use. No structural PCO equivalent. */
const SINGLE_EXECUTOR_RE =
  /single executor|single user|experimental.?use|ad.?hoc use|personal workspace/i;

/** Tier 2 HIGH — explicit governance absence / non-production statement. */
const NO_GOVERNANCE_RE =
  /no refresh schedule|not scheduled|unmanaged|no governance|no sla|not production.grade|not intended for production/i;

/** Tier 4 MEDIUM — high null rate on a key column. */
const NULL_RATE_HIGH_RE = /null.?rate.*?(0\.[3-9]|\d\d%)/i;

// ── Guard flag helpers ─────────────────────────────────────────────────────────

export function isCaveatGuardEnabled(orgId: string): boolean {
  if (process.env.MEMORY_CAVEAT_GUARD_ENABLED !== 'true') return false;
  const orgs = (process.env.MEMORY_CAVEAT_GUARD_ORGS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  // Fail-closed: if ENABLED but ORGS is empty, guard runs for NO orgs.
  if (orgs.length === 0) return false;
  return orgs.includes(orgId);
}

function guardLevel(): CaveatTier {
  const raw = (process.env.MEMORY_CAVEAT_GUARD_LEVEL ?? 'HIGH').toUpperCase();
  if (raw === 'MEDIUM') return 'MEDIUM';
  return 'HIGH';
}

// ── Session-level table path extraction ───────────────────────────────────────

/**
 * Extract all unique 3-part table paths from a session's ACTION trace nodes.
 *
 * Applies extractSchemaIdentifiers() (from validate.ts) to JSON.stringify(toolParams)
 * for every ACTION node. Returns only paths that contain exactly two dots (3 parts),
 * which is the minimum for a Databricks catalog.schema.table path.
 *
 * Per the real-sample test (§1 of the plan): all four real table paths were
 * correctly extracted; 2-part schema-level paths (e.g. 'reporting_layer.crp') are
 * naturally filtered out at lookup time since no PCO full_path has only 2 parts.
 */
function extractSessionTablePaths(traceNodes: TraceWalkRow[]): string[] {
  const paths = new Set<string>();

  for (const node of traceNodes) {
    if (node.nodeType !== 'ACTION') continue;

    const payload = node.payload as Record<string, unknown> | null | undefined;
    if (!payload?.toolParams) continue;

    const raw = JSON.stringify(payload.toolParams);
    const identifiers = extractSchemaIdentifiers(raw);

    for (const id of identifiers) {
      // Only keep full 3-part paths (exactly 2 dots — catalog.schema.table)
      if ((id.match(/\./g) ?? []).length === 2) {
        paths.add(id.toLowerCase());
      }
    }
  }

  return [...paths];
}

// ── PCO batch lookup ───────────────────────────────────────────────────────────

interface PcoRow {
  full_path:         string;
  schema_name:       string | null;
  source_altered_at: Date | null;
  last_t0_at:        Date | null;
  card:              unknown;               // SemanticCard JSON | null
  card_confidence:   number | null;
  card_status:       string | null;
}

async function fetchPcoRows(orgId: string, paths: string[]): Promise<PcoRow[]> {
  if (paths.length === 0) return [];

  // LATERAL join fetches the most recent semantic card regardless of status.
  // status='assumed' is the default for all real scratchpad cards — filtering
  // on status='observed' would return 0 rows for the entire scratchpad estate.
  const rows = await prisma.$queryRaw<PcoRow[]>`
    SELECT
      pco.full_path,
      pco.schema_name,
      pco.source_altered_at,
      pco.last_t0_at,
      pcs.card,
      pcs.confidence  AS card_confidence,
      pcs.status      AS card_status
    FROM platform_context_objects pco
    LEFT JOIN LATERAL (
      SELECT card, confidence, status
      FROM platform_context_semantics
      WHERE subject_id   = pco.id
        AND subject_kind = 'object'
      ORDER BY version DESC
      LIMIT 1
    ) pcs ON true
    WHERE pco.org_id    = ${orgId}
      AND pco.full_path = ANY(${paths}::text[])
      AND pco.lifecycle = 'active'
  `;

  return rows;
}

// ── Caveat signal derivation ───────────────────────────────────────────────────

function deriveSignals(row: PcoRow): CaveatSignal[] {
  const signals: CaveatSignal[] = [];

  // ── Tier 1 Structural HIGH: scratchpad schema ────────────────────────────
  if (row.schema_name && row.schema_name.toLowerCase().includes('scratchpad')) {
    signals.push({
      kind:   'structural',
      tier:   'HIGH',
      reason: `schema_name '${row.schema_name}' contains 'scratchpad'`,
    });
  }

  // ── Tier 3 Structural MEDIUM: staleness ─────────────────────────────────
  if (row.source_altered_at && row.last_t0_at &&
      row.source_altered_at > row.last_t0_at) {
    signals.push({
      kind:   'structural',
      tier:   'MEDIUM',
      reason: `source_altered_at (${row.source_altered_at.toISOString()}) > last_t0_at (${row.last_t0_at.toISOString()})`,
    });
  }

  // ── Semantic checks (T2 card must exist) ────────────────────────────────
  const cardObj = row.card as Record<string, unknown> | null | undefined;
  if (!cardObj) return signals;

  const caveats = Array.isArray(cardObj.caveats)
    ? (cardObj.caveats as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];

  for (const text of caveats) {
    // Tier 2 HIGH: single executor / ad-hoc use
    if (SINGLE_EXECUTOR_RE.test(text)) {
      signals.push({ kind: 'semantic', tier: 'HIGH', reason: text });
    }
    // Tier 2 HIGH: explicit no-governance / non-production
    else if (NO_GOVERNANCE_RE.test(text)) {
      signals.push({ kind: 'semantic', tier: 'HIGH', reason: text });
    }
    // Tier 4 MEDIUM: high null rate on key column
    else if (NULL_RATE_HIGH_RE.test(text)) {
      signals.push({ kind: 'semantic', tier: 'MEDIUM', reason: text });
    }
  }

  // Tier 4 MEDIUM: low card confidence
  if (typeof row.card_confidence === 'number' && row.card_confidence < 0.5) {
    signals.push({
      kind:   'semantic',
      tier:   'MEDIUM',
      reason: `semantic card confidence ${row.card_confidence.toFixed(2)} < 0.5`,
    });
  }

  return signals;
}

function highestTier(signals: CaveatSignal[]): CaveatTier | null {
  if (signals.some(s => s.tier === 'HIGH'))   return 'HIGH';
  if (signals.some(s => s.tier === 'MEDIUM')) return 'MEDIUM';
  if (signals.length > 0)                     return 'LOW';
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a CaveatMap for one session: extract table paths from trace nodes,
 * batch-resolve against PCO + semantic cards, and return a map of
 * full_path → CaveatEntry for every path that has at least one caveat signal.
 *
 * Paths that resolve to no PCO row are silently skipped (D1).
 * Paths with no signals (clean tables) are absent from the returned map.
 *
 * Returns an empty map when traceNodes is empty or when all paths are clean.
 */
export async function buildSessionCaveatMap(
  orgId:      string,
  traceNodes: TraceWalkRow[],
): Promise<CaveatMap> {
  const caveatMap: CaveatMap = new Map();

  const paths = extractSessionTablePaths(traceNodes);
  if (paths.length === 0) return caveatMap;

  const rows = await fetchPcoRows(orgId, paths);

  for (const row of rows) {
    const signals = deriveSignals(row);
    const tier    = highestTier(signals);
    if (!tier || tier === 'LOW') continue;   // LOW never blocks — omit from map

    caveatMap.set(row.full_path.toLowerCase(), {
      fullPath: row.full_path,
      tier,
      signals,
    });
  }

  if (caveatMap.size > 0) {
    console.log(
      `[caveat-guard] org=${orgId} paths_scanned=${paths.length}` +
      ` caveated=${caveatMap.size}` +
      ` (${[...caveatMap.keys()].join(', ')})`,
    );
  }

  return caveatMap;
}

/**
 * Determine whether a candidate bullet should be quarantined based on the
 * session's caveat map.
 *
 * Returns null if the bullet should pass through (no HIGH path reference, or
 * ruleType is exempt). Returns a BulletCaveatResult if the bullet should be
 * quarantined.
 *
 * Exempt ruleTypes (D5): HARD_RULE, FAILURE_MODE, SCHEMA_MAP.
 * These reflect error patterns and schema facts — still useful even from a
 * caveated source; only their HEURISTIC/SOURCE_PREF derivatives are suppressed.
 */
export function checkBulletCaveat(
  ruleText:   string,
  ruleType:   string,
  caveatMap:  CaveatMap,
): BulletCaveatResult | null {
  // Exempt types — never quarantined regardless of source caveats (D5).
  if (ruleType === 'HARD_RULE' || ruleType === 'FAILURE_MODE' || ruleType === 'SCHEMA_MAP') {
    return null;
  }

  if (caveatMap.size === 0) return null;

  const threshold = guardLevel();

  // Extract all schema identifiers the bullet text names (full dotted paths + parts).
  // Cross-reference against the caveated paths set.
  const identifiers = extractSchemaIdentifiers(ruleText).map(s => s.toLowerCase());

  const triggered: CaveatEntry[] = [];
  for (const [path, entry] of caveatMap) {
    if (entry.tier !== 'HIGH' && threshold === 'HIGH') continue;

    // Match if the bullet contains the full path OR any individual path component
    // (e.g. 'ss_scratchpad' or 'vessel_issues_qhse' alone is enough — it's specific
    // enough to identify the caveated table, and the full path is often truncated
    // in bullet prose).
    const pathParts = path.split('.');
    const matched = identifiers.includes(path) ||
      pathParts.some(part => part.length >= 6 && identifiers.includes(part));

    if (matched) {
      triggered.push(entry);
    }
  }

  if (triggered.length === 0) return null;

  const allSignals = triggered.flatMap(e => e.signals);
  const tier = highestTier(allSignals) ?? 'HIGH';

  return {
    tier,
    paths:   triggered.map(e => e.fullPath),
    signals: allSignals,
  };
}
