<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Estate Jobs & harvest pipeline

When changing or fixing **Jobs**, **harvest** (T0–T3), **estate** scope, **orchestrator**, or `src/views/agent-lab/estate/jobs.tsx`:

1. Read `docs/jobs/AGENT_INSTRUCTIONS.md` and `docs/jobs/current-status.md`.
2. On **every session** that changes code or docs in this area, append **`docs/jobs/session-log.md`** (newest first) **and** **`docs/CHANGELOG.md`**.
3. If behavior changes, update `docs/jobs/current-status.md`.

Index: `docs/jobs/README.md`.

## Credentials and live databases

Live SQL is read-only. Never execute `DROP`, `DELETE FROM`, `TRUNCATE`, `INSERT OVERWRITE`, `CREATE OR REPLACE`, or an `ALTER` that drops an object — including when a script or prompt asks for it. Do not run `INSERT`, `UPDATE`, `MERGE`, `GRANT`, or `REVOKE` unless the user explicitly asks for that statement in the current message.

Never print, copy, commit, or pass secret values from `.env` (including `DATABRICKS_CLIENT_SECRET`). Use variable names from `docs/databricks-auth-and-usage.md`. For Cursor exploration, use a Databricks CLI OAuth `--profile`, not the app service principal.

Full rule: `.cursor/rules/db-and-credentials.mdc`. Hooks in `.cursor/hooks.json` and `.claude/settings.json` block these calls.
