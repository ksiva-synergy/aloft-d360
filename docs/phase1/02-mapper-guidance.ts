// ============================================================================
// 02-mapper-guidance.ts
// DATA-3a: rows→option mapper — how to extend buildPreviewOption to fill
// real data into the ECharts option that currently emits empty series.
//
// This is NOT a drop-in file. It's annotated guidance for modifying:
//   src/components/inspector/dashboard-builder/WidgetPreview.tsx
//
// The key gotcha is the alias-vs-label mismatch (memory §4.5). If you get
// this wrong, charts render with correct axes but empty series — visually
// indistinguishable from the current placeholder, making it look like
// nothing changed.
// ============================================================================

// STEP 1: Import toAlias from the compiler
// -----------------------------------------
// toAlias is the function compileSemanticQuery uses to turn definition labels
// into SQL column aliases (snake_case). The same function MUST be used here
// to look up column values in result rows, because the rows' keys are the
// compiler's aliases, not the human-readable labels.
//
// import { toAlias } from "@/lib/semantic/compiler";
//
// ASSUMPTION: toAlias is exported from compiler.ts. If it's not exported
// (only used internally), either export it or copy its logic — but DO NOT
// reimplement it differently, or the mismatch comes back. Grep for `toAlias`
// in compiler.ts to find the exact function.

// STEP 2: Extend buildPreviewOption's signature
// -----------------------------------------------
// Currently (per memory doc §2.1):
//   buildPreviewOption(widget, resolvedDefs) → EChartsOption
//   - emits series: [{ data: [] }]
//   - adds a PREVIEW — NO DATA graphic overlay
//
// Extend to:
//   buildPreviewOption(widget, resolvedDefs, rows?: Record<string, unknown>[]) → EChartsOption
//   - when rows is undefined/empty → keep existing placeholder behavior (unchanged)
//   - when rows has data → fill series with real values, remove the overlay

// STEP 3: The actual mapping (the part that breaks silently if wrong)
// -------------------------------------------------------------------
// Here's a pseudo-implementation. Adapt to the actual shape of your
// ECharts option building — the specifics depend on chart kind (bar, line,
// scatter, KPI, etc.) but the column-lookup pattern is universal.

/*
function buildPreviewOption(
  widget: WidgetSpec,
  resolvedDefs: ResolvedDefinitions,
  rows?: Record<string, unknown>[]
): EChartsOption {
  // ... existing axis/label setup from resolvedDefs (unchanged) ...

  if (!rows || rows.length === 0) {
    // Existing placeholder path — KEEP THIS UNCHANGED.
    // Return the current series: [{ data: [] }] + PREVIEW graphic.
    return existingPlaceholderOption;
  }

  // --- NEW: fill data from rows ---

  // For each dimension used as a category axis:
  const dimDef = resolvedDefs.dimensions[0]; // ASSUMPTION: verify actual structure
  const dimAlias = toAlias(dimDef.label);     // "Order Date" → "order_date"
  const categories = rows.map(r => r[dimAlias]);
  //                                ^^^^^^^^^ NOT r[dimDef.label]

  // For each measure used as a value axis / series:
  const series = widget.semanticQuery.measures.map(measureId => {
    const measureDef = resolvedDefs.measures[measureId]; // ASSUMPTION: lookup by id
    const measureAlias = toAlias(measureDef.label);      // "Total Revenue" → "total_revenue"

    return {
      name: measureDef.label,                // human label for the legend
      type: widget.chartKind,                // 'bar', 'line', etc.
      data: rows.map(r => r[measureAlias]),  // actual values from the aliased column
      //                    ^^^^^^^^^^^^ NOT r[measureDef.label]
    };
  });

  return {
    // ... axis config from resolvedDefs (existing, mostly unchanged) ...
    xAxis: { type: 'category', data: categories },
    series,
    // DO NOT include the "PREVIEW — NO DATA" graphic overlay when rows exist
  };
}
*/

// STEP 4: Chart-kind-specific handling
// -------------------------------------
// The pseudo-code above covers the common bar/line case. Different chart
// kinds need different mappings:
//
// - bar / line / area: xAxis categories + series values (above)
// - scatter: dataset rows or explicit [x, y] pairs
// - pie / donut: data: [{ name: category, value: measure }]
// - KPI / big-number: single value extracted from rows[0][measureAlias]
// - heatmap: [dimAlias1, dimAlias2, measureAlias] triples
// - table: pass rows through directly (column headers = labels, keys = aliases)
//
// In every case, the lookup in the row object uses toAlias(def.label), not
// def.label directly. This is the one rule that cannot be broken.

// STEP 5: Write a test that catches the silent failure
// -----------------------------------------------------
// The alias-vs-label mismatch produces correct axes with empty series,
// which looks identical to the current placeholder. The only way to catch
// it is an explicit test. Pseudo-test:
//
//   test('measure column resolves via toAlias', () => {
//     const label = "Total Revenue";
//     const alias = toAlias(label);
//     const mockRow = { total_revenue: 42 };
//     expect(mockRow[alias]).toBe(42);
//     expect(mockRow[label]).toBeUndefined(); // this is the bug if you use label
//   });
//
//   test('buildPreviewOption fills series when rows are provided', () => {
//     const rows = [{ order_date: '2026-01', total_revenue: 100 }];
//     const option = buildPreviewOption(widget, defs, rows);
//     expect(option.series[0].data).toEqual([100]); // not []
//     expect(option.graphic).toBeUndefined(); // no "PREVIEW" overlay
//   });

// STEP 6: Things NOT to do
// --------------------------
// - Do NOT reuse the DSL-driven pipeline mapper from chart-pipeline.ts.
//   Widgets store chartConfig (a simplified spec), not the full DSL the
//   chat pipeline uses. The widget path and the chat path diverge here by
//   design (memory §4.6).
// - Do NOT call compileSemanticQuery from the client — compilation and
//   execution happen server-side in the widget-data route. The mapper
//   only receives the already-executed rows.
// - Do NOT use lodash.snakeCase or any other snake_case converter as a
//   substitute for toAlias — if toAlias has any special handling (e.g.
//   stripping special chars, handling collisions), a different converter
//   will diverge silently.
