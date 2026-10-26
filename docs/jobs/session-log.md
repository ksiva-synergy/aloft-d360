# Jobs / harvest — session log

**Purpose:** Running log of agent and engineer sessions that touch the harvest job pipeline.  
**Newest first.** See [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md).

---

## Entry template (copy for each session)

```markdown
### YYYY-MM-DD — <short title> (<Cursor|Claude|Human>)

- **Issues:** P0-3, … (or “docs only”)
- **Files:** `path/a`, `path/b`
- **Before → after:** …
- **Verified:** …
- **Not done:** …
```

---

### 2026-10-24 — Versioning + incremental policy doc (Cursor)

- **Issues:** Product rule from user — incremental OK when keeping versions; aligned docs with T1/T2 append-only tables.
- **Files:** `docs/jobs/versioning-and-incremental.md`; updates to `current-status.md`, `schema-harvest-guide.md`, `AGENT_INSTRUCTIONS.md`, `README.md`; `docs/CHANGELOG.md`.
- **Before → after:** Incremental guidance now explicit: T1/T2 version on re-run; T0 delta without structural version chain; overwrite toggles target new versions.
- **Verified:** `profile.ts` / `enrich.ts` `persistCard` version increment; prisma `platform_context_profiles`, `platform_context_semantics`.
- **Not done:** T1 stale-only skip; T0 structural snapshots; job stats showing version counts in UI.

---

### 2026-10-24 — Jobs docs pack + agent logging rules (Cursor)

- **Issues:** Documentation for P0-3, schema harvest, incremental policy; no code fixes yet.
- **Files:** `docs/jobs/README.md`, `current-status.md`, `schema-harvest-guide.md`, `AGENT_INSTRUCTIONS.md`, `session-log.md`; `AGENTS.md`, `CLAUDE.md`; `docs/estate-jobs.md`; `docs/audits/harvest-job-pipeline-remediation-charter.md` (cross-link); `docs/CHANGELOG.md`.
- **Before → after:** Jobs workstream had audits/charter only; now has operator schema guide, full current-status snapshot, and mandatory dual logging (CHANGELOG + this file) for Claude/Cursor.
- **Verified:** Cross-walk issue register ↔ current-status tables; paths exist in repo.
- **Not done:** Phase 0 code (`planEstateSplit`, UI wizard, schema Run button); P0-3 still blocks first T0 in modal.

---

### 2026-10-24 — Remediation charter + audit field report (Cursor)

- **Issues:** P0-3, P1-1, P1-7, P1-20, P2-16; charter phases for all P0–P3.
- **Files:** `docs/audits/harvest-job-pipeline-remediation-charter.md`, `docs/audits/harvest-job-pipeline-issues.md`, `docs/CHANGELOG.md`.
- **Before → after:** Audit expanded with T0 modal field report; charter defines cockpit UX and phased fixes.
- **Verified:** Code touchpoints listed in issues §13.
- **Not done:** Implementation.
