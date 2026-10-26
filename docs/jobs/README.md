# Estate harvest & jobs — documentation index

**Last updated:** 2026-10-24

| Document | Audience | Purpose |
|----------|----------|---------|
| [current-status.md](./current-status.md) | Eng + ops | **Snapshot** of how jobs work today, gaps, and incremental vs overwrite behavior |
| [schema-harvest-guide.md](./schema-harvest-guide.md) | Operators | Harvest **one catalog.schema** with minimal blast radius; what to run when |
| [versioning-and-incremental.md](./versioning-and-incremental.md) | Eng + ops | **Incremental vs overwrite** tied to profile/semantic **version** history |
| [session-log.md](./session-log.md) | Claude + Cursor | **Append every working session** that touches jobs/harvest code or docs |
| [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) | Claude + Cursor | Mandatory rules for agents on this workstream |

**Related (repo root / audits):**

- [../estate-jobs.md](../estate-jobs.md) — UI map and APIs  
- [../audits/harvest-job-pipeline-issues.md](../audits/harvest-job-pipeline-issues.md) — issues register  
- [../audits/harvest-job-pipeline-remediation-charter.md](../audits/harvest-job-pipeline-remediation-charter.md) — cockpit UX + phased fixes  
- [../CHANGELOG.md](../CHANGELOG.md) — repo-wide product changelog (required on every code change)
