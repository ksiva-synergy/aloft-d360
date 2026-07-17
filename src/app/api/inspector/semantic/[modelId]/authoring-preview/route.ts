import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { resolveToolCatalogEntry } from '@/lib/inspector/tools';
import {
  executeSemanticQuery,
  SemanticDraftAccessError,
  SemanticValidationFailureError,
} from '@/lib/semantic/execute';
import type { SemanticQuery } from '@/lib/semantic/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/semantic/[modelId]/authoring-preview  (Phase 3.5B)
 *
 * The live draft preview — the FIRST consumer of 3.5A's authoring-mode bypass.
 * Executes a SemanticQuery in authoring mode so the caller can see their own
 * draft definition computing against real data before saving/submitting.
 *
 * SECURITY BOUNDARY (3.5A owner-only enforcement in action):
 *   - authoringUserId is ALWAYS the authenticated session user — never a
 *     client-supplied id. A caller cannot preview someone else's draft by
 *     forging a user id.
 *   - The 3.5A bypass enforces per-referenced-row ownership. Passing a foreign
 *     user's draft definition id makes executeSemanticQuery throw
 *     SemanticDraftAccessError, which we return as a clean 403 (never a 500,
 *     never a leak).
 *   - modelId is pinned to the route param; a mismatched body modelId is
 *     ignored.
 *
 * Execution still flows through executeDatabricksSQL (the read-only chokepoint).
 * Authoring mode changes which definitions are allowed, never how SQL runs.
 *
 * Body: { query: SemanticQuery }
 * Returns: { sql, columns, rows, rowCount, isDraft }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { modelId } = await params;
    const body = (await request.json()) as { query?: unknown };
    const incoming = body.query as Partial<SemanticQuery> | undefined;
    if (!incoming || typeof incoming !== 'object' || !incoming.entityId) {
      return NextResponse.json({ error: 'query.entityId is required' }, { status: 400 });
    }

    // Pin modelId to the route param; never trust a body modelId.
    const query: SemanticQuery = {
      modelId,
      entityId: incoming.entityId,
      dimensions: Array.isArray(incoming.dimensions) ? incoming.dimensions : [],
      measures: Array.isArray(incoming.measures) ? incoming.measures : [],
      filters: Array.isArray(incoming.filters) ? incoming.filters : [],
      sorts: Array.isArray(incoming.sorts) ? incoming.sorts : [],
      limit: typeof incoming.limit === 'number' ? incoming.limit : 100,
      timeGrain: incoming.timeGrain,
    };

    if (query.measures.length === 0 && query.dimensions.length === 0) {
      return NextResponse.json({ error: 'preview needs at least one measure or dimension' }, { status: 400 });
    }

    // Resolve the org's default Databricks connection the same way the Inspector
    // chat does (tool_catalog slug 'synergy_dwh' → config.connection_id).
    const catalog = await resolveToolCatalogEntry('');
    const connectionId = (catalog?.config as Record<string, string> | null)?.connection_id ?? null;
    if (!connectionId) {
      return NextResponse.json(
        { error: 'No active Databricks connection — cannot run preview.' },
        { status: 503 },
      );
    }

    // ── The 3.5A authoring bypass — owner-verified per referenced row ─────────
    const result = await executeSemanticQuery(query, connectionId, {
      authoringMode: true,
      authoringUserId: currentUser.id, // ALWAYS the session user
    });

    return NextResponse.json({
      sql: result.sql,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      isDraft: result.isDraft,
      definitionsUsed: {
        dimensions: query.dimensions.map((d) => d.dimensionId),
        measures: query.measures.map((m) => m.measureId),
      },
    });
  } catch (err) {
    // Owner-only boundary: previewing another user's draft → clean 403.
    if (err instanceof SemanticDraftAccessError) {
      return NextResponse.json(
        { error: err.message, tableKind: err.tableKind, rowId: err.rowId },
        { status: 403 },
      );
    }
    if (err instanceof SemanticValidationFailureError) {
      return NextResponse.json({ error: err.message, errors: err.errors }, { status: 400 });
    }
    console.error('[semantic/authoring-preview POST]', err);
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 });
  }
}
