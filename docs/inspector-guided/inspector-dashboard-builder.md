# Inspector & the Dashboard Build section

This document describes the **Dashboard Build** surface (the "dashboard builder") and how it
links up with the **Inspector** — the chat-driven data-exploration workbench it lives inside.

Everything here is under the `/inspector` route tree and the `inspector` component/lib
namespaces. The two surfaces share one backbone: the **semantic layer** (governed
entities / dimensions / measures) and the **Studio chart DSL**.

---

## 1. The big picture

There are two distinct-but-connected surfaces:

| Surface | What it is | Nature of its output |
|---|---|---|
| **Inspector** | A chat shell where you ask questions in natural language, the agent writes SQL / semantic queries against Databricks, and results render live in a right-hand pane. | **Ephemeral** — results live for the session. |
| **Dashboard Builder** ("dashboard build") | A grid editor where governed dimensions/measures and previously-saved charts are composed into a **persistent, versioned, shareable** dashboard. | **Persistent** — saved as immutable versions in Postgres. |

The bridge between them is the **saved chart**: a chart produced during an Inspector chat can
be promoted ("Save to Charts") and then dropped onto a widget in the Dashboard Builder.

```
┌─────────────────────────── Inspector (chat) ───────────────────────────┐
│  InspectorShell                                                          │
│   ├─ PromptCanvas ............. 60% conversation (LLM + SQL/semantic)    │
│   └─ Right pane (40%) ........ tabs: Results | Semantic Governance       │
│        ├─ SemanticChartCard .. inline semantic chart + "Save to Charts"  │
│        └─ DashboardPane ...... ephemeral table + ad-hoc ChartBuilder     │
│                                                                          │
│      "Save to Charts"  ──POST /api/inspector/charts──▶ platform_charts   │
└──────────────────────────────────────┬───────────────────────────────────┘
                                        │  saved chart (chart_dsl + semanticQuery
                                        │               + frozen measure_snapshots)
                                        ▼
┌────────────────────── Dashboard Builder (build) ────────────────────────┐
│  DashboardBuilder (/inspector/dashboards/[id]/builder)                   │
│   ├─ DefinitionPicker (left) . tabs: Definitions | Charts ◀── saved chart│
│   ├─ BuilderGrid (center) .... 12-col drag/resize widget grid            │
│   └─ Config / History (right)  WidgetConfigPanel · VersionHistoryPanel   │
│                                                                          │
│      "SAVE"  ──POST …/dashboards/[id]/versions──▶ immutable version row  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The Dashboard Build section

### 2.1 Routes

| Path | File | Purpose |
|---|---|---|
| `/inspector/dashboards` | [page.tsx](../src/app/(agent)/inspector/dashboards/page.tsx) | Dashboard list — All / Mine / Shared-with-me tabs, search, create, delete, share, copy-link. |
| `/inspector/dashboards/[id]/builder` | [builder/page.tsx](<../src/app/(agent)/inspector/dashboards/[dashboardId]/builder/page.tsx>) | Server component that renders `<DashboardBuilder dashboardId={…} />`. |

The list page's **NEW DASHBOARD** flow prompts for a name + semantic model id, `POST`s to
`/api/inspector/dashboards`, and routes to the builder. Cards navigate to the builder on
click, or `?share=1` to open straight into the Share dialog.

### 2.2 Component tree

All under [src/components/inspector/dashboard-builder/](../src/components/inspector/dashboard-builder/):

- **`DashboardBuilder.tsx`** — the orchestrator. Loads the dashboard + current version,
  loads the semantic definitions for its `modelId`, wires the left picker / center grid /
  right panel, computes drift, and handles save.
- **`builder-store.ts`** — Zustand + immer store. Holds `widgets[]`, `selectedWidgetId`,
  `driftMap`, `dirty`/`saving`/`saveError`, and all mutations (`addWidget`,
  `updateWidget`, `updateWidgetSemanticQuery`, `updateWidgetPosition`, …). `addWidget`
  auto-places the new widget with `findOpenPosition` in a 12-column grid.
- **`DefinitionPicker.tsx`** — left rail with two tabs:
  - **Definitions** — governed entities → dimensions & measures, click-to-add to the
    selected widget. Status badges: `GOV` (governed) vs `CAND` (candidate).
  - **Charts** — lists saved charts (`GET /api/inspector/charts?modelId=…`); clicking one
    assigns it wholesale to the selected widget. **This is the link back to the Inspector.**
- **`BuilderGrid.tsx`** — the center 12-column widget grid (drag/resize, selection).
- **`WidgetConfigPanel.tsx`** — right panel for the selected widget (title, chart kind,
  axis slots, drift indicators). Read-only for viewers.
- **`VersionHistoryPanel.tsx`** + **`version-diff.ts`** — version list & diffing; supports
  restore.
- **`ShareDialog.tsx`** — visibility + collaborator management.

### 2.3 The unit of work: `WidgetSpec`

Defined in [src/lib/dashboards/types.ts](../src/lib/dashboards/types.ts). A dashboard version
stores a JSONB array of these:

```ts
interface WidgetSpec {
  widgetId: string;                 // stable cuid2 across versions
  title: string;
  chartKind: 'kpi'|'bar'|'line'|'donut'|'scatter'|'heatmap'|'histogram';
  semanticQuery: SemanticQuery;     // references dims/measures BY ID (labels stay live)
  measureSnapshots: MeasureSnapshot[]; // frozen aggregate/expression/metric_type at save
  chartConfig: { x?; y?[]; series?; value?; echartsOption? };
  position: { col; row; w; h };     // 12-col grid placement
}
```

Two ideas drive the design:

1. **Live references** — `semanticQuery` stores dimension/measure **IDs**, so labels and
   descriptions always reflect the current governed definition.
2. **Frozen snapshots** — `measureSnapshots` captures the *computation-relevant* fields
   (`aggregate`, `expression`, `metric_type`) at save time. At render/edit time the builder
   compares live definitions against the snapshot to surface **drift**.

### 2.4 Drift detection

`DashboardBuilder.computeDriftMap()` runs whenever widgets or definitions change and
classifies each widget:

- **`ok`** — all referenced defs exist and match their snapshot.
- **`changed`** — a measure's `aggregate` / `expression` / `metric_type` differs from the
  frozen snapshot ("definition changed since last save").
- **`unavailable`** — a referenced dim/measure ID no longer resolves in the model.

The map lives in the store (`setDriftMap`) and drives badges in the grid/config panel.

### 2.5 Saving = new immutable version

`handleSave` → `POST /api/inspector/dashboards/[id]/versions`
([route.ts](<../src/app/api/inspector/dashboards/[dashboardId]/versions/route.ts>)):

1. Load dashboard (must exist, not deleted).
2. **`validateWidgetReferences`** — rejects (400) any widget referencing a dim/measure from
   a *different* model (cross-model guard).
3. **`computeMeasureSnapshots`** — re-freezes snapshots server-side, embedded per widget.
4. Write version with `version_number = max + 1`. There is no lock — the
   `UNIQUE(dashboard_id, version_number)` constraint turns a concurrent write into a loud
   **409** ("Concurrent save detected — reload & retry") rather than silent loss.
5. Point the parent dashboard's `current_version_id` at the new version.
6. Write a `save_version` audit row.

Because the server recomputes snapshots, the builder **reloads the dashboard after save** so
local state matches the persisted snapshots and drift stays accurate.

### 2.6 Access control (RBAC)

Roles: `owner` | `editor` | `viewer` | `org_member` (synthetic — org-visible, no explicit
collaborator row → view-only). Visibility: `private` | `org` | `shared`.

- `viewer` / `org_member` → **read-only** builder (picker hidden, no Add/Save, "VIEW ONLY").
- `owner` / `editor` → can edit; both can **Share**; only `owner` can **Delete**.

Permission logic: [src/lib/dashboards/permissions.ts](../src/lib/dashboards/permissions.ts).

---

## 3. The Inspector (host surface)

### 3.1 `InspectorShell`

[src/components/inspector/InspectorShell.tsx](../src/components/inspector/InspectorShell.tsx) —
the workbench. Layout:

- **Status bar** — SPINOR / INSPECTOR breadcrumb, **Databricks connected** chip, a
  **context-mode toggle** (`CATALOG + SQL` harvested T0/T1/T2 context vs `SQL ONLY`
  warehouse-only), plus New session / Performance Lab / History buttons.
- **Left 60%** — `PromptCanvas` conversation, backed by the `useInspectorChat` hook.
- **Right 40%** — tabbed between **Results** and **Semantic Governance**
  (`SemanticGovernancePanel`, shown here only when a candidate semantic model
  exists in the session). `SemanticGovernancePanel` has exactly two mount sites:
  this in-session tab, and the always-available **`/agent-lab/metrics`** route
  ([page.tsx](<../src/app/(agent)/agent-lab/metrics/page.tsx>)), which mounts the
  same component with org-wide scope (My Drafts / What I've Taught aggregated
  across every model) so the authoring surface is reachable without an active
  Inspector session. It is **not** mounted in `DashboardBuilder`.
  - `SemanticChartCard`s stack above the results when the agent emits semantic charts.
  - `DashboardPane` below shows the latest query result.

Sessions auto-rename from the first couple of exchanges; `DataStudio` opens as a full
expansion of the current results (hotkey **E**).

### 3.2 `DashboardPane` (the ephemeral viz pane)

[src/components/inspector/DashboardPane.tsx](../src/components/inspector/DashboardPane.tsx) —
**not** the dashboard builder; it visualizes the *current session's* query results:

- A result-history strip (`Q1 · 42r`, …) to flip between queries.
- A collapsible SQL preview badge.
- A compact `DataTable`.
- An ad-hoc `ChartBuilder` (table/bar/line/area/pie/scatter) with auto axis detection.
- **EXPAND** → opens the full `DataStudio`.

This is the quick-look counterpart to the persistent builder — same visual language, no
persistence.

### 3.3 `SemanticChartCard` — the promotion point

[src/components/inspector/SemanticChartCard.tsx](../src/components/inspector/SemanticChartCard.tsx)
renders a semantic chart inline in the chat and exposes **"Save to Charts"**, which
`POST`s to `/api/inspector/charts` with the `chartDsl` + `semanticQuery`. That saved chart is
exactly what the Dashboard Builder's **Charts** tab later lists and assigns.

---

## 4. How the two link up

### 4.1 Shared foundations

- **Semantic layer** — both read governed entities/dimensions/measures via
  `/api/inspector/semantic/*`. Widgets and saved charts reference the same definition IDs.
- **Studio chart DSL** — `ChartDSLSpec` ([src/lib/studio/chart-dsl.ts]) is the common chart
  language. Inspector emits it; the builder consumes it. `DashboardBuilder` maps DSL kinds
  onto `WidgetSpec.chartKind` via `dslKindToWidgetKind` / `encodingsToChartConfig`
  (e.g. `stacked-bar`→`bar` with a preserved `echartsOption` stack override).
- **Governance helpers** — `computeMeasureSnapshots` freezes snapshots for **both** saved
  charts and dashboard versions, so drift semantics are identical across surfaces.

### 4.2 The end-to-end flow

```
1. Ask a question in Inspector chat.
2. Agent runs a semantic query → SemanticChartCard renders the chart.
3. Click "Save to Charts"  → POST /api/inspector/charts
      → platform_charts row: { chart_dsl, semantic_query, measure_snapshots (frozen) }
4. Open/create a dashboard → /inspector/dashboards/[id]/builder
5. In the DefinitionPicker "Charts" tab, the saved chart appears
      (GET /api/inspector/charts?modelId=…, matched on the dashboard's model_id).
6. Select a widget → click the chart → it copies title, kind, semanticQuery,
      measureSnapshots, and chartConfig onto that widget (one-time copy).
7. SAVE → new immutable dashboard version; snapshots re-frozen server-side.
```

Key constraint that makes the link coherent: a saved chart only shows up in a builder whose
`model_id` matches the chart's model, and `validateWidgetReferences` blocks saving any widget
that references a different model. **One dashboard = one semantic model.**

---

## 5. Data model & API surface

**Postgres tables** (Prisma): `platform_charts`, `platform_dashboards`,
`platform_dashboard_versions` (immutable JSONB `widgets` + `layout`),
`platform_dashboard_collaborators`, `platform_dashboard_audit`.

**API routes** under [src/app/api/inspector/](../src/app/api/inspector/):

| Route | Verb(s) | Role |
|---|---|---|
| `charts` | GET / POST | List saved charts by model; promote a semantic chart. |
| `charts/[chartId]` | … | Single saved-chart ops. |
| `dashboards` | GET / POST | List (All/Mine/Shared) & create. |
| `dashboards/[id]` | GET / DELETE | Load (dashboard + current version + myRole) / soft-delete. |
| `dashboards/[id]/versions` | GET / POST | History / create immutable version. |
| `dashboards/[id]/restore` | POST | Restore a prior version. |
| `dashboards/[id]/share` | POST | Change visibility. |
| `dashboards/[id]/collaborators` | … | Manage collaborators. |
| `semantic/[modelId]/definitions` | GET | Entities/dims/measures for the picker. |
| `semantic/candidates` | GET | Whether candidate models exist (Semantic tab gating). |

---

## 6. File map (quick reference)

```
src/app/(agent)/inspector/
  page.tsx / [sessionId]/page.tsx ......... Inspector chat entry
  dashboards/page.tsx ..................... Dashboard list
  dashboards/[id]/builder/page.tsx ........ Builder entry (server)

src/components/inspector/
  InspectorShell.tsx ...................... chat workbench (host)
  DashboardPane.tsx ....................... ephemeral session-result viz
  SemanticChartCard.tsx ................... inline chart + "Save to Charts"
  dashboard-builder/
    DashboardBuilder.tsx .................. builder orchestrator
    builder-store.ts ...................... Zustand widget/layout/save state
    DefinitionPicker.tsx .................. Definitions + Charts tabs (the link)
    BuilderGrid.tsx ....................... 12-col widget grid
    WidgetConfigPanel.tsx ................. per-widget config
    VersionHistoryPanel.tsx / version-diff.ts .. versions & diff
    ShareDialog.tsx ....................... visibility/collaborators

src/lib/dashboards/
  types.ts ................................ WidgetSpec, MeasureSnapshot, roles
  permissions.ts .......................... RBAC resolution
  governance.ts ........................... validateWidgetReferences, computeMeasureSnapshots

src/hooks/useInspectorChat.ts ............. chat state, query results, semantic charts
```
