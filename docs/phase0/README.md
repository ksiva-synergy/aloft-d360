# Phase 0 — Foundations: Reference Implementation

**Decisions locked for this pass:**
- **DEC-1: connection binding is per-dashboard.** `connection_id` lives on `platform_dashboards`, not `platform_semantic_models`. Two dashboards on the same governed model may now legitimately point at different warehouses (e.g. staging vs. prod) — that's accepted, not a bug.
- **Provenance: `source_chart_id` is in.** Added to `WidgetSpec` now (Phase 0 migration) even though the "Open source chart in Inspector" UI ships in Phase 2 — avoids a second schema touch.

**Important caveat:** this session has access to your two planning markdowns only, not the live `aloft-d360` source tree. Every file below is a **complete, ready-to-adapt reference implementation** that follows the exact pattern your memory doc documents (`share/route.ts`'s `getServerSession → getUserByEmail → getDashboardRole → predicate` chain). I've marked every assumption inline with `// ASSUMPTION:` comments — mostly import paths (`next-auth`, your Prisma client singleton, `authOptions`) and the exact shape of `getDashboardRole`. Swap those to match your actual imports and this should drop in with minimal changes.

If you paste in the real files, I'll turn this into exact diffs instead of full-file reference implementations.

## What's in this folder

| File | Maps to | Item |
|---|---|---|
| `01-schema-migration.prisma` | `prisma/schema.prisma` (diff) | DEC-1 + provenance schema changes |
| `02-backfill-migration.sql` | new Prisma migration | Backfill `connection_id` before NOT NULL |
| `03-versions-route.ts` | `src/app/api/inspector/dashboards/[id]/versions/route.ts` | SEC-1 |
| `04-restore-route.ts` | `src/app/api/inspector/dashboards/[id]/restore/route.ts` | SEC-1 |
| `05-dashboard-id-route.ts` | `src/app/api/inspector/dashboards/[id]/route.ts` | SEC-3 (DELETE guard) |
| `06-audit-actor.ts` | `src/lib/dashboards/audit.ts` (new or existing) | SEC-2 |
| `07-connection-resolution.ts` | `src/lib/dashboards/connection.ts` (new) | DEC-1 resolver, replaces `resolveToolCatalogEntry('')` for dashboards |
| `08-widget-spec-types.ts` | `src/lib/dashboards/types.ts` (diff) | Provenance + freshness type additions |
| `09-checklist.md` | — | Verification checklist before calling Phase 0 done |

## Sequencing

Apply in this order:
1. `01` + `02` (schema + backfill) — do this first, in a maintenance window if the table has real rows, since it changes the shape widgets and dashboards are read against.
2. `06` (audit actor helper) — needed by `03`, `04`, `05`.
3. `07` (connection resolver) — needed by `03`'s snapshot step if you want to validate the binding exists before allowing a save (optional but recommended).
4. `03`, `04`, `05` (the three route patches) — independent of each other, can land in parallel PRs.
5. `08` (type additions) — can land anytime; it's additive and doesn't change runtime behavior until Phase 1/2 code reads the new fields.
6. `09` — run through this before marking Phase 0 shipped.
