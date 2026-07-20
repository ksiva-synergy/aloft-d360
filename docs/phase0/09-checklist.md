# Phase 0 — Verification Checklist

Run through all of these before calling Phase 0 done. Several are explicitly
called out in the memory doc as the thing that will bite you if skipped.

## Schema / migration

- [ ] `connection_id` added to `platform_dashboards` as **nullable** first (01)
- [ ] Backfill query run against production data; verified `SELECT count(*) ... WHERE connection_id IS NULL AND deleted_at IS NULL` returns **0** before proceeding (02)
- [ ] Soft-deleted dashboards handled explicitly (either backfilled too, or excluded from the NOT NULL constraint) — decide and document which
- [ ] Follow-up NOT NULL migration applied **only after** the above is verified clean
- [ ] `source_chart_id` and `freshness` added to `WidgetSpec` type (08) — confirm this required **zero** Prisma migration (it's JSONB) and did not break existing stored widgets on read

## SEC-1 (save + restore gating)

- [ ] `versions/route.ts` POST: authenticated `viewer`/`org_member` gets **403**, not a successful save
- [ ] `versions/route.ts` POST: authenticated `owner`/`editor` still succeeds (regression check — this is the easy one to break)
- [ ] `restore/route.ts` POST: same two checks as above
- [ ] Confirm `getDashboardRole` returning `null` (no access at all, e.g. private dashboard) returns **404**, not 403 (avoid leaking existence) — or align with whatever `share/route.ts` actually does if it differs
- [ ] Cross-model guard (`validateWidgetReferences`) still runs and still returns 400 for cross-model widget references — unchanged by this patch, but verify the gate didn't get reordered incorrectly relative to the new role check
- [ ] Snapshot re-freezing (`computeMeasureSnapshots`) still runs server-side on every save — unchanged, verify

## SEC-2 (actor forgeability)

- [ ] Grep the whole `dashboards/` API tree for `body.actor`, `body.createdBy`, or any audit-row `actor:` field sourced from the request body — there should be **zero** remaining after this patch
- [ ] Audit rows for save / restore / delete now contain the real session user's email/id, verified by manually triggering each action and inspecting the `platform_dashboard_audit` table
- [ ] If a service/system actor path is genuinely needed anywhere, confirm it goes through `resolveServiceActor` (header + `INSPECTOR_SERVICE_TOKEN`), not a body field

## SEC-3 (DELETE guard inversion)

- [ ] Simulate the "valid token, no User row" case (e.g. a test user deleted after token issuance, or mock `getUserByEmail` to return null) and confirm DELETE now returns **401**, not a successful delete
- [ ] Confirm this matches `share/route.ts`'s existing behavior for the same case (consistency check across routes)

## DEC-1 (per-dashboard connection binding)

- [ ] `resolveDashboardConnectionId` / `loadDashboardForExecution` (07) resolve correctly for a backfilled dashboard
- [ ] Calling it on a dashboard with `connection_id IS NULL` (shouldn't exist post-backfill, but test anyway) throws `DashboardConnectionUnboundError`, not a silent fallback to a global default — per-dashboard DEC-1 means **no** model-level or global fallback is acceptable in this code path
- [ ] Confirm the Inspector chat's own connection resolution (`resolveToolCatalogEntry('')`) is **untouched** — this patch intentionally does not unify chat and dashboard connection resolution under per-dashboard DEC-1

## General

- [ ] All three route patches (03, 04, 05) still pass through the edge `middleware.ts` auth gate unchanged — this patch adds a *second*, deeper layer (role check), it doesn't replace the first (token check)
- [ ] No regressions in `share/route.ts` or `collaborators/route.ts` — they were already correct; confirm nothing here accidentally touched them
- [ ] Doc-vs-tracker note from memory doc respected: SEC-1/2/3 tracked as issue-tracker items during the work, **not** written into the public "known limitations" doc until shipped
