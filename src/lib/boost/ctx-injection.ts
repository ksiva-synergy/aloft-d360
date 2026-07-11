import 'server-only';
import { describeObject } from '@/lib/context/describe';
import type { BoostCase } from '@/lib/boost/suite';

/**
 * Connection name used for catalog card lookups.
 * Matches the display name registered in platform_context_sources for synergy_dwh.
 * Override via env to point at a different registered connection without code changes.
 */
export const BOOST_CATALOG_CONNECTION =
  process.env.BOOST_CATALOG_CONNECTION ?? 'synergy_dwh';

// ── Block format ──────────────────────────────────────────────────────────────

function formatTableContextBlock(fullPath: string, card: object): string {
  return [
    `--- TABLE CONTEXT: ${fullPath} ---`,
    JSON.stringify(card, null, 2),
    `--- END TABLE CONTEXT ---`,
  ].join('\n');
}

// ── Single-card fetch ─────────────────────────────────────────────────────────

async function fetchTableCard(
  orgId: string,
  fullPath: string,
): Promise<object | null> {
  try {
    const result = await describeObject({
      orgId,
      connection: BOOST_CATALOG_CONNECTION,
      path: fullPath,
      detail: 'full',
    });
    if (!result) return null;
    return result as object;
  } catch (err) {
    console.warn(`[boost/ctx-injection] fetchTableCard failed for ${fullPath}:`, err);
    return null;
  }
}

// ── Ordered table list ────────────────────────────────────────────────────────

/**
 * Returns the de-duped, ordered list of full_paths to fetch cards for.
 *
 * - joinPath == null  → [sourceTable]  (single-table; V1 and easy V2 behavior)
 * - joinPath != null  → sourceTable first, then each joinPath.tables entry that
 *                       differs from sourceTable, preserving array order.
 */
export function resolveInjectionTableOrder(boostCase: BoostCase): string[] {
  if (!boostCase.joinPath) {
    return [boostCase.sourceTable];
  }
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const path of [boostCase.sourceTable, ...boostCase.joinPath.tables]) {
    if (!seen.has(path)) {
      seen.add(path);
      ordered.push(path);
    }
  }
  return ordered;
}

// ── Main injection block builder ──────────────────────────────────────────────

/**
 * Builds the full multi-table context injection string for a CTX-mode run.
 *
 * - Fetches cards in resolveInjectionTableOrder order.
 * - Missing cards (not yet harvested) emit a console.warn and are skipped.
 * - Returns '' when no cards were fetched (caller should skip prepend).
 * - SQL arm: this function must never be called for warehouse_only runs.
 */
export async function buildCtxInjectionBlock(
  boostCase: BoostCase,
  orgId: string,
): Promise<string> {
  const tables = resolveInjectionTableOrder(boostCase);
  const blocks: string[] = [];

  for (const fullPath of tables) {
    const card = await fetchTableCard(orgId, fullPath);
    if (!card) {
      console.warn(`[boost/ctx-injection] no card available for '${fullPath}' — skipping`);
      continue;
    }
    blocks.push(formatTableContextBlock(fullPath, card));
  }

  return blocks.join('\n\n');
}
