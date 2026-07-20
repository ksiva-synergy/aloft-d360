// ============================================================================
// 08-widget-spec-types.ts
// Additive changes to WidgetSpec: source_chart_id (provenance, decided) and
// a freshness field stub (Phase 2 feature, scaffolded now since we're
// already touching this type).
//
// Maps to: src/lib/dashboards/types.ts (diff — add fields, don't replace
// the file)
// ============================================================================

// ----------------------------------------------------------------------------
// BEFORE (per memory doc — reconstructed shape, verify against your real file):
// ----------------------------------------------------------------------------
//
// export interface WidgetSpec {
//   id: string;
//   title: string;
//   chartKind: string;
//   semanticQuery: SemanticQuery;
//   measureSnapshots: Record<string, MeasureSnapshot>;
//   chartConfig: ChartConfig;
//   layout: { x: number; y: number; w: number; h: number };
// }

// ----------------------------------------------------------------------------
// AFTER
// ----------------------------------------------------------------------------

export interface WidgetSpec {
  id: string;
  title: string;
  chartKind: string;
  semanticQuery: SemanticQuery;
  measureSnapshots: Record<string, MeasureSnapshot>;
  chartConfig: ChartConfig;
  layout: { x: number; y: number; w: number; h: number };

  // --- Provenance (decided, Phase 0 schema / Phase 2 UI) -------------------
  // Non-authoritative back-reference to the platform_charts row this widget
  // was copied from, if any. NEVER used to auto-propagate edits — drift is
  // still computed only against live semantic definitions (memory doc §2.3
  // invariant preserved). Purely for:
  //   (a) "Open source chart in Inspector" from a widget (Phase 2 UI)
  //   (b) lineage/debugging ("where did this widget come from")
  // Optional because:
  //   - widgets built directly in the builder (no chat origin) have none
  //   - the source chart may later be deleted; a dangling reference here is
  //     expected and must be handled as "source unavailable" in the UI, not
  //     as a foreign-key constraint (this field is NOT a DB relation)
  source_chart_id?: string;

  // --- Freshness policy (scaffolded now, wired up in Phase 2 §3.3) --------
  // Left optional/unused until the viewer route + result cache exist.
  // Absence of this field == 'live' (always re-run on load), which is the
  // safe default per the Phase 2 plan.
  freshness?: {
    mode: "live" | "cached" | "scheduled";
    staleAfterSec?: number; // required semantics when mode === 'cached'
    schedule?: string; // cron string, required semantics when mode === 'scheduled'
  };
}

// ----------------------------------------------------------------------------
// Migration note: WidgetSpec lives inside a JSONB column (dashboard version
// payload), not a relational table (memory doc §1.2). Adding optional fields
// here requires NO Prisma migration and is backward compatible — existing
// stored widgets simply parse with `source_chart_id: undefined` and
// `freshness: undefined`, which your Phase 1/2 code should treat exactly as
// described above (no source, defaults to live).
//
// Do add a runtime guard wherever WidgetSpec is deserialized from stored
// JSON, e.g. in a Zod schema if you validate on read:
//
//   export const WidgetSpecSchema = z.object({
//     // ...existing fields...
//     source_chart_id: z.string().optional(),
//     freshness: z
//       .object({
//         mode: z.enum(["live", "cached", "scheduled"]),
//         staleAfterSec: z.number().optional(),
//         schedule: z.string().optional(),
//       })
//       .optional(),
//   });
// ----------------------------------------------------------------------------
