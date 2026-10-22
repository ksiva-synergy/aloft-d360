# Changelog

## 2026-10-22 — Restore Bedrock Titan v2 for estate embeddings

- **`src/lib/azure/embed-client.ts`**: Titan `amazon.titan-embed-text-v2:0` primary again (`InvokeModel`); OpenAI/Foundry fallback; `embedBulkWithFallback` with `EMBED_BULK_CONCURRENCY` (default 8). `EMBED_OPENAI_ONLY=1` skips Titan.
- **`src/lib/context/embed.ts`**: Estate embed job uses bulk concurrent Titan calls before DB upsert (objects + columns).
- **Verified:** `npm run typecheck`. Fargate uses **task role** creds (no access keys in task def); `BEDROCK_REGION=us-east-1` in `task-definition.json`. IAM: `bedrock:InvokeModel` on Titan v2 for `aloftEcsTaskRole`.
- **Deploy:** pushed to `feature/estate-jobs` and `main` (`ecr-push.yml` builds web + harvester images, Beanstalk deploy on `main`). **Not done:** `aws ecs register-task-definition` for the new `BEDROCK_REGION` env (no local AWS creds) — run step 3 in `infra/context/deploy-notes.md`; code already defaults `BEDROCK_REGION` to `us-east-1`, so this is mainly the `HARVESTER_VERSION` label.

## 2026-10-21 — Embedding coverage audit script

- **`scripts/context/embedding-audit.ts`**: read-only counts for `platform_context_embeddings`, T2 vs object-embed gap, estate lifecycle, recent embed/T2 jobs (uses `noserver.cjs` + `.env.local` DB).
- Verified against `verify-estate-1` source: **14,710** embedding rows (no orphans on removed context objects); **1,520 / 1,539** T2 objects have object embeddings (**22** backlog).

## 2026-10-21 — Estate Jobs UX and launch scope fixes

- **`docs/estate-jobs.md`**: Jobs section mental model (L1/L2/L3, parent/child, APIs, playbook).
- **`src/lib/estate/job-ui.ts`**: Shared status/stats helpers (`orchestrating`, `empty` success, `formatStatsSummary`, Focus in scope column).
- **Launch / plan**: Strip `excludeSchemas` for T1/T2; `planSplit` respects `includePatterns`; **400 NO_OBJECTS_IN_SCOPE** when scanned count is 0; plan returns `scopeWarning`, `harvestModelId` (T2), object count.
- **Launch modal**: Hide exclude tree for T1/T2-only; show scanned object count, warnings, T2 model; block launch when scope empty.
- **`ChildJobsPanel`**: Extracted + poll; orchestrating parents on list/drawer/detail.
- **Job list/detail**: **EMPTY** chip for succeeded-with-zero-work; status poll every 10s on active jobs.
- **Tests**: `src/lib/estate/job-ui.test.ts` (vitest).

## 2026-10-21 — Jobs children API UUID validation

- `GET /api/agent-lab/context/jobs/[id]/children` returns **400** with a clear message when `id` is not a full UUID (avoids Prisma **500** on placeholders like `PASTE_PARENT_JOB_ID` or the `/jobs` list path).

## 2026-10-21 — Jobs launch dialog discovery clarity

- `listEstateFacets` optional `sourceId` filter; facets API `?sourceId=`; Jobs modal loads facets per source, shows `scope_include` + catalog count, and notes that **Estate Inventory** ignores the exclude tree / Focus.
- Fixed test-source facet exclusion (`source_id` text vs uuid cast).
- Cherry-picked onto `chore/remove-azure-workflow` for deploy (Beanstalk + harvester ECR via `ecr-push.yml`).

## 2026-10-21 — Estate restore script + source POST restore

- `scripts/context/estate-restore-scope.ts`: restore `lifecycle=removed` rows, widen `scope_include`, optional `--inventory` (uses `noserver.cjs` + prod DB from `.env.local`).
- `POST /api/agent-lab/context/sources/[id]` with `{ widenScope?: true }` restores removed discovery rows for that source (deploy required on aloft-dev).
- Ran restore (3 rows) + widen + inventory for `verify-estate-1`: **35 catalogs**, inserted **15036**, updated **38452**; re-applied steward `scope_exclude` list after inventory.

## 2026-10-21 — Estate inventory partial-sweep soft-delete fix

- `src/lib/context/estate.ts`: lifecycle `removed` pass now only applies to **catalogs inventoried in that run** (`catalogsSeen`), so a partial inventory (e.g. one catalog / narrow scope) no longer marks all other discovery rows as dropped.
- Recovery for rows already marked `removed`: set `lifecycle = 'active'` in DB or re-run a full-scope inventory after widening `scope_include` (upsert sets `lifecycle = 'active'`).
- Verified: `npx tsc --noEmit`.

## 2026-10-21 — Context source scope PATCH API

- Added `GET` / `PATCH` `src/app/api/agent-lab/context/sources/[id]/route.ts` so estate sources can update `scope_include`, `scope_exclude`, and `display_name` (e.g. widen to `["*.*.*"]` before a full inventory).
- Verified: TypeScript compile on new route only; not deployed.

## 2026-10-21 — Data Estate HTML in-depth reference

- Expanded `docs/data-estate-system.html` with a new **In-depth reference** section (sidebar TOC): steady-state playbooks in plain English, scope/`last_sweep_at`/delta T0, inventory vs columns, T0–T4 storage and Databricks sources, T1 `top_k` and weekly re-profile rationale, T2 dual storage + LLM batching (25 columns), embed call volume, T3 usage grain vs notebook/job, T4 job tree and orchestrator “not ported” status, versioning table, and Mermaid data-flow diagram.
- Glossary and file index entries updated; T0 tier summary corrected (row estimates from T1).
- Verified: static HTML (open in browser); no app build required.

## 2026-10-21 — SSO-only authentication

- Removed the local admin email/password form from `src/app/login/page.tsx`; Microsoft SSO is now the only login option shown.
- Removed the NextAuth credentials provider and restricted interactive sign-in callbacks to Azure AD in `src/lib/auth.ts`.
- Updated user creation in `src/app/api/users/route.ts` and `src/components/users/InviteUserModal.tsx` to create SSO accounts without local passwords.
- Updated the authentication middleware documentation in `src/middleware/auth.ts`.
- Verification: `npm run typecheck`, `npm run build`, and IDE lint diagnostics.
- Deploy: merged to `Synergy-Marine-Group/aloft-d360` `main` (commit `00c507d` on branch; merge commit on `main`) to trigger **Build, push ECR, deploy Beanstalk** GitHub Actions.
- Not done: existing password hashes and legacy credential-provider labels in the database were not migrated or deleted. Did not push to `DATA360Portal_ReactJS` (separate legacy React portal repo).
