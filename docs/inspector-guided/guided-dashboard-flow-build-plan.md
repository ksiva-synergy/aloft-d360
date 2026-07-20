# Build Plan — Guided Dashboard Creation (NL-first)

> **Goal.** Replace the cold-start empty grid with a **natural-language-first, guided-by-default**
> authoring flow: ask what the dashboard is *for* → the LLM proposes a set of charts grounded in
> the governed catalog → the user curates that plan → then walks each chart to refine source,
> filters, and visual polish. The current PowerBI-style drag-and-drop grid becomes a **manual
> toggle**, not the primary path.
>
> **The one architectural commitment.** Guided and manual are **two views over one
> `WidgetSpec[]` dashboard state**, switchable at any moment without losing work — not two
> products. Everything below follows from this.
>
> **Grounding key.** `[C]` = confirmed against `/mnt/project/` docs · `[I]` = inferred from a
> documented mechanic · `[U]` = named only in the walkthrough spec / kickoff prompt / screenshot,
> **not** in the source docs — must be pinned against real code before trusting.

---

## Where this sits relative to the existing plan

This feature is an **authoring surface** over machinery the Technical Implementation Plan already
scopes. It does not introduce a new execution engine. It reuses:

- the NL→chart pipeline (`runSemanticChartPipeline` / `emit_semantic_chart`) `[C]` (memory §4.1);
- `executeSemanticQuery(query, connectionId)` as a plain server function `[C]` (memory §4.2);
- the widget-data route + rows→option mapper + viewer (TIP Phase 1, DATA-1/2/3) `[C]`;
- smart chart-type inference (`chart-defaults.ts`, TIP §4.4) `[I]` (planned, not yet built);
- the trust spine, disambiguation UI, draft-then-accept, generative empty states (TIP §4.2–4.6).

It respects every invariant: one dashboard = one model; versions immutable; snapshots re-frozen
server-side; `executeDatabricksSQL` chokepoint; governed-only execution `[C]` (memory §8).

---

## Phase 0 — Prerequisites `[hard prerequisite]`

Do not start the guided UI until these are real, or the flow will demo green on empty data and
break live — the exact failure pattern the walkthrough spec exists to catch.

1. **TIP Phase 0 landed** — SEC-1/2/3 authz gates + DEC-1 connection binding + migration `[C]`.
   Guided mode exposes *more* creation surface; it cannot sit on the open save/restore holes.
2. **TIP Phase 1 landed** — the data render path (DATA-1 widget-data route, DATA-3 rows→option
   mapper with the `toAlias` fix, and the read-only viewer) `[C]`. Stage 3 (live drill-in) is
   blocked without it.
3. **Authoring-preview bypass confirmed** `[U]` — the deliberate, **author-scoped** bypass of the
   `governed`-only gate so a draft/candidate definition renders live in preview (walkthrough
   seam 1). This is what lets guided **create** against live data before anything is governed.
   **Pin it against real code** (branch, error type, owner-scoping) before relying on it. Without
   it, guided drill-in on this estate renders nothing (see Risk 1).
4. **NL-intent / vocabulary substrate scoped to the populated org** `[U]` — the captured-intent
   embeddings (Step 0 backfill) + synonym resolution (seams 6–7) that power Stage 1 topic seeds
   and Stage 2 proposals. This is the **same `[U]` substrate** the Teach and Metric Store plans
   depend on; pin it **once, first**. If it ran against the empty/demo org, guided mode degrades
   to generic filler and looks like a UI bug (see Risk 2).
5. **`chart-defaults.ts` exists** (TIP §4.4) — pure module inferring default chart type from a
   field combination. Both the blueprint step and the drill-in call it. `[I]`

---

## Phase 1 — Shared-state foundation + mode toggle

The load-bearing phase. Build the shared state before any stage UI.

- **One authoring store over `WidgetSpec[]`.** Extend `builder-store.ts` (TIP §6.2) with a
  `mode: 'guided' | 'manual' | 'view'` slice and a guided-session slice (intent, blueprint,
  drill-in cursor). Guided stages **read/write the same widgets** the RGL grid renders — no
  parallel wizard state tree. `[C]` store exists (memory §7).
- **Mode toggle** in the builder header, beside the existing ADD WIDGET / VERSIONS / SHARE / SAVE
  controls (screenshot). Default selection:
  - **empty dashboard → guided** (cold start is exactly where a blank grid is hostile);
  - **existing dashboard → manual / view**.
- **Switching is lossless.** Guided→manual drops into the grid with whatever's built so far;
  manual→guided resumes the blueprint. This round-trip is the acceptance test for Phase 1.

---

## Phase 2 — Stage 1: Intent

- **Prompt the decision, not the chart.** *"What should this dashboard help you understand or
  decide?"* The decision is what lets the model reason about *which governed metrics matter*.
- **Never a blank box.** Seed 3–5 starter topics derived from the real model — the generative
  empty state (TIP §4.6), powered by the Phase-0 NL-intent embeddings. (For the current estate:
  accident root-cause, inspection compliance, crew risk exposure, etc.)
- **Resolve the model + disambiguate.** Stage 1 infers the semantic model and confirms it, since
  one dashboard = one model `[C]`. Ambiguous terms surface the disambiguation UI (TIP §4.3):
  solid = matched governed field, amber = ambiguous → chooser, red = unrecognized.
- **Emits** a resolved intent object (see Appendix A) consumed by Stage 2.

---

## Phase 3 — Stage 2: Blueprint (the hero)

The conceptual center, and the **single human-judgment gate** — concentrate approval here, because
a wrong proposal is cheap to delete from a list and expensive to unwind mid-drill-in.

- **The LLM proposes a coherent `ChartBlueprint[]`** (Appendix B): 4–6 line items, each with a
  title, the measure(s)/dimension(s) it will use, an inferred filter set, a `chart-defaults`
  chart-type guess, and a one-line rationale. **Nothing renders yet** — this is a reviewable
  outline.
- **Grounded, or it refuses.** Proposals come **from the governed catalog**. A requested metric
  that isn't defined is surfaced as a "not defined yet — define it?" item linking to the Teach /
  DefineMetric flow, never fabricated. This is "refuse rather than guess" (TIP §4.2) applied to
  authoring.
- **Curate:** reorder, rename, remove, "add another," or "accept all." Draft-then-accept
  (TIP §4.5) at the *dashboard* level.
- **Contract** (Appendix C): each accepted `ChartBlueprint` maps to a `WidgetSpec` —
  `semanticQuery` carries definition **IDs** (live references), `measureSnapshots` are frozen at
  pin time server-side `[C]` (memory §1.2, §1.4), `chartConfig` seeded from `chart-defaults`.

---

## Phase 4 — Stage 3: Per-chart drill-in

Guided, **not a forced wizard**. Each item renders **live**, pre-filled — the user edits a working
chart, not a blank form.

- **Per-chart panel, all pre-filled:** Source (resolved governed defs + a collapsible read-only
  SQL trust panel from `compileSemanticQuery`, TIP §4.2); Filters (editable, expressed as
  `semanticQuery` filters, never client row hacks); Visual (the smart default + "why this +
  one-click alternatives" gallery, TIP §4.4); Polish (title, color, format).
- **NL refine bar** — "break this out by vessel type," "last quarter only" — re-runs the grounded
  pipeline (TIP §4.5).
- **Progress rail = the blueprint.** Jump to any chart, skip, or "accept the rest as-is." Never a
  locked stepper.
- **Governance / candidate handling.** For the author's own draft/candidate def, render via the
  authoring-preview bypass (Phase-0 item 3) stamped "Draft — not governed" `[U]`. Otherwise show
  an explicit "publish to see live data" state — **never a 500** (TIP §9). The `toAlias`
  label→alias mapping gotcha applies: miss it and you get correct axes with empty series, visually
  identical to the old placeholder `[C]` (memory §4.5 / TIP §2.2).
- **Confirm → append/patch the `WidgetSpec`** in shared state.

---

## Phase 5 — Stage 4: Assemble + save

- Confirmed widgets land in the grid — guided auto-lays-out; manual rearranges (RGL, TIP §5.1).
- **Save = new immutable version** `[C]` (memory §1.4, §8); snapshots re-frozen server-side; the
  guided session may be reconstructable from the intent + blueprint for "edit the plan" later.

---

## Phase 6 — Manual-mode parity

- The screenshot's 12-column RGL builder: LIBRARY panel (Definitions / Charts tabs, filtered by
  `model_id`) + WIDGET CONFIG panel `[C]` (memory §1.1, §7).
- Edit gated by `canEditDashboard`; viewer read-only via `canViewDashboard` `[C]` (memory §1.5,
  §3). Enforce in **both** UI and API — the core lesson of the memory doc.
- Guided ↔ manual round-trip preserves widgets (shared-state guarantee, Phase 1).

---

## Appendix A — Intent resolution (draft type)

```ts
interface ResolvedIntent {
  modelId: string;            // confirmed; one dashboard = one model
  topic: string;              // user's decision/question, verbatim
  relevantMeasureIds: string[];
  relevantDimensionIds: string[];
  disambiguations?: { term: string; candidates: string[]; chosenId?: string }[];
}
```

## Appendix B — `ChartBlueprint` (draft type)

```ts
interface ChartBlueprint {
  id: string;
  title: string;
  measureIds: string[];
  dimensionIds: string[];
  filters: SemanticFilter[];          // inferred; editable in Stage 3
  chartKindGuess: ChartKind;          // from chart-defaults.ts
  rationale: string;                  // one line: "why this chart"
  grounding: 'governed' | 'candidate' | 'undefined';  // 'undefined' → Teach nudge
}
```

## Appendix C — `ChartBlueprint` → `WidgetSpec` mapping

| Blueprint field | WidgetSpec target | Notes |
|---|---|---|
| `measureIds` / `dimensionIds` | `semanticQuery` (IDs) | live references `[C]` (memory §1.2) |
| `filters` | `semanticQuery.filters` | governed filters, not row hacks |
| `chartKindGuess` + Stage-3 edits | `chartConfig` / `chartKind` | seeded by `chart-defaults` |
| (server, at pin) | `measureSnapshots` | re-frozen server-side `[C]` (memory §1.4) |
| — | `source_chart_id?` | optional back-ref if promoted from a chat chart (TIP §3.2) |

**Defensive pin at execution** `[C]` (TIP §2.1, memory §4.6): set
`semanticQuery.modelId = dashboard.model_id` at data-fetch time; do not trust the stored value.

---

## Dependencies & sequencing

```
TIP Phase 0 (SEC-1/2/3, DEC-1, connection migration)
        │
        ▼
TIP Phase 1 (data path: DATA-1/2/3)  +  Phase-0 substrate pin (NL-intent, authoring bypass)
        │
        ▼
Guided P1 (shared state + toggle)
        ▼
Guided P2 (intent) → P3 (blueprint) → P4 (drill-in) → P5 (assemble+save)
        │
        └── Guided P6 (manual parity) runs alongside — same WidgetSpec[] the whole time
```

---

## Risks & watch-items

1. **CAND-only estate blocks live drill-in.** Every definition in the current screenshot is
   `CAND`; `executeSemanticQuery` throws unless `governed` `[C]`. Until the authoring-preview
   bypass (Phase-0 item 3) is confirmed *or* definitions are governed, Stage 3 cannot render live.
   The blueprint step (Stage 2) still works — it only proposes. Do not ship guided drill-in
   claiming "live" until this is settled.
2. **Substrate empty/wrong-org → generic blueprints.** If the NL-intent backfill ran against the
   demo org (the documented "empty-org backfill" finding; `getDefaultOrg()` single-org assumption,
   memory §5.8), Stage 1/2 quality collapses and it *looks like* a UI bug. Pin the substrate first.
3. **Over-asking in the drill-in makes it tedious.** Auto-fill every sub-step; make the blueprint
   the only mandatory approval gate.
4. **Forced-wizard rigidity.** Keep escape hatches: jump-to-chart, skip, accept-rest, bail-to-manual.
5. **`toAlias` empty-series false-green** (memory §4.5 / TIP §2.2, §9). Write the label→alias test
   before shipping Stage 3.
6. **Draft leakage.** If authoring preview isn't strictly owner-scoped, a draft can leak into a
   shared surface (walkthrough seam 2 / seam 8). Assert the 403 owner boundary.
7. **Model binding timing.** Decide whether guided creates the dashboard→model binding up front
   (Stage 1) or defers to first save — one dashboard = one model must hold either way.

---

## Open questions

1. **Blueprint size** — default count (4–6?) and a hard cap?
2. **Authoring-preview bypass** — is it confirmed 3.5-era behavior, and is it owner-scoped? (Pin.)
3. **Binding timing** — create dashboard + model binding at Stage 1, or at first save?
4. **Streaming** — reuse the Inspector chat SSE plumbing to stream blueprint generation and
   drill-in re-runs (TIP §4.1), or a simpler request/response for v1?
5. **Reputation** — does completing a guided dashboard earn `semantic_authoring`-style credit? If
   so, pin `applyOutcomeForUser` and assert delta + correct user, not row existence (seam 3/6 trap).
