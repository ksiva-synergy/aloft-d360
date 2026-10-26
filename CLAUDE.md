@AGENTS.md

## Changelog

Log every change in `docs/CHANGELOG.md` (newest first): what changed, file paths, why, how it was verified, and what is not done. A Stop hook (`.claude/hooks/changelog-guard.mjs`) reminds you if files changed after the last entry.

## Estate Jobs / harvest sessions

For work on Jobs, harvest tiers, estate scope, or `scripts/context/orchestrator.ts`:

- Follow **`docs/jobs/AGENT_INSTRUCTIONS.md`** (mandatory).
- Append **`docs/jobs/session-log.md`** on every session that fixes or changes anything in this workstream (in addition to `docs/CHANGELOG.md`).
- Keep **`docs/jobs/current-status.md`** accurate when runtime or UI behavior changes.
