# Agent instructions — Estate Jobs & harvest pipeline

**Applies to:** Cursor Agent, Claude Code, and any human following the same workstream.  
**Read this** at the start of a session when the user mentions Jobs, harvest, T0–T3, estate, launch modal, or Fargate context workers.

---

## 1. Mandatory logging (every session)

If you **change or fix anything** (code, config, docs, tests) related to jobs, harvest, estate scope, orchestrator, or `src/views/agent-lab/estate/jobs.tsx`:

### 1.1 Repo changelog (always)

Add a **newest-first** entry to [`docs/CHANGELOG.md`](../CHANGELOG.md) with:

- **What** — files touched  
- **Why** — user intent or bug ID (e.g. P0-3)  
- **Verified** — command, test, or manual step  
- **Not done** — follow-ups  

This is already required by [`CLAUDE.md`](../../CLAUDE.md) / workspace rules.

### 1.2 Jobs session log (this workstream)

Add a **newest-first** entry to [`docs/jobs/session-log.md`](./session-log.md) using the template in that file.

Include:

- Date (UTC or user TZ), agent (Cursor / Claude), short session title  
- Issues addressed (register IDs if any)  
- Files changed  
- Operator-visible behavior before → after  
- Link to PR or commit if applicable  

**Even doc-only updates** to `docs/jobs/*` or harvest audits count — log them.

### 1.3 Current status doc (when behavior changes)

If runtime or UI behavior changes, update [`docs/jobs/current-status.md`](./current-status.md):

- § “Last verified” date  
- Any table row that is no longer true  
- Move fixed items from “Known gaps” to “Recently fixed” with date  

Do **not** skip logging because the change “was small.”

---

## 2. Product rules (implement toward these)

1. **Schema-first** — Operators must be able to harvest **`catalog.schema`** without full-source runs. Scope = `includePatterns: ['catalog.schema.*']` (see [schema-harvest-guide.md](./schema-harvest-guide.md)).
2. **Run only what’s needed** — Default incremental (T0 delta, T2 stale-only). Full rescan / re-profile / re-enrich only via explicit **Overwrite** or **Force full scan** (when implemented in UI). **Incremental is appropriate when runs append versions** (T1 profiles, T2 semantic cards); see `docs/jobs/versioning-and-incremental.md`.
3. **One honest count** — Never show two object totals without labeling **Discovery** vs **Scanned** (see remediation charter).
4. **Launch = worker** — Enqueue paths used by UI must start Fargate/local orchestrator unless labeled “queue only.”
5. **No false green** — Stub or zero-object success must not show as DONE without an EMPTY or warning state.

---

## 3. Before coding

1. Read [current-status.md](./current-status.md) § Known gaps — do not re-break documented constraints.  
2. Check [harvest-job-pipeline-issues.md](../audits/harvest-job-pipeline-issues.md) for the issue ID.  
3. Prefer fixes that match [harvest-job-pipeline-remediation-charter.md](../audits/harvest-job-pipeline-remediation-charter.md) phase order (Phase 0 before cockpit UI).

---

## 4. Key code paths (quick map)

| Concern | Location |
|---------|----------|
| Launch modal | `src/views/agent-lab/estate/jobs.tsx` |
| Plan / assert | `src/app/api/agent-lab/context/jobs/plan/route.ts`, `launch/route.ts` |
| Split / queue | `src/lib/context/queue.ts` |
| T0 / T1 | `src/lib/context/harvest.ts` |
| T2 | `src/lib/context/enrich.ts` |
| Orchestrator | `scripts/context/orchestrator.ts` |
| Job UI helpers | `src/lib/estate/job-ui.ts` |
| Scope globs | `src/lib/context/scope-match.ts` |

---

## 5. Session checklist (copy into session log “Notes”)

```text
[ ] Read docs/jobs/current-status.md
[ ] Identified issue IDs (if any)
[ ] Code/docs change complete
[ ] docs/CHANGELOG.md updated
[ ] docs/jobs/session-log.md updated
[ ] docs/jobs/current-status.md updated (if behavior changed)
```

---

## 6. Cursor-specific

- Workspace rule in root `CLAUDE.md` points here via `AGENTS.md` — keep **Harvest jobs** subsection in sync when this file changes.
- Use absolute paths in logs when citing files under `c:\ALOFT\aloft-ui-redesign`.

---

## 7. Claude-specific

- Same logging as §1; Stop hook may remind about `docs/CHANGELOG.md` — **also** append `docs/jobs/session-log.md`.
- Do not mark audit issues “fixed” in the register until code ships; use session log + CHANGELOG for in-progress work.
