# Estate harvest & jobs — documentation index

**Last updated:** 2026-10-28

| Document | Audience | Purpose |
|----------|----------|---------|
| [current-status.md](./current-status.md) | Eng + ops | **Snapshot** of how jobs work today, gaps, and incremental vs overwrite behavior |
| [scanned-continue-pipeline-design.md](./scanned-continue-pipeline-design.md) | Product + eng + ops | **Design (not shipped):** Continue pipeline from Scanned & beyond, pipeline intent API, UX, reliability |
| [ops-console-gaps-and-vision.md](./ops-console-gaps-and-vision.md) | Ops + eng + product | **Today’s run monitoring**, OPS gap register, **Active runs** tab vision (unified ops desk) |
| [remediation-master-plan.md](./remediation-master-plan.md) | Eng + product + ops | **Phased plan to fix** pipeline + ops gaps (DET-2592): phases 0–5, PR order, verification |
| [phase-0-chain-deploy.md](./phase-0-chain-deploy.md) | Ops + eng | **Deploy checklist**, chain vs web kick, stuck-job runbook (Phase 0 / PR-A) |
| [schema-harvest-guide.md](./schema-harvest-guide.md) | Operators | Harvest **one catalog.schema** with minimal blast radius; what to run when |
| [embeddings-lifecycle-and-drops.md](./embeddings-lifecycle-and-drops.md) | Ops + support + eng | Why embeddings seem **inactive** — object `dropped`, search filters, T0 drop pass, incident |
| [tier-timestamps-and-staleness.md](./tier-timestamps-and-staleness.md) | Ops + support + eng | **`last_t0_at` / `last_t1_at` / `last_t2_at`** — what they mean, examples, when each tier is needed |
| [redundancy-and-skip-behavior.md](./redundancy-and-skip-behavior.md) | Ops + eng + product | **When tiers skip work**, launch paths (Continue vs full pipeline vs cockpit), force flags, job stats |
| [efficient-pipeline-playbook.md](./efficient-pipeline-playbook.md) | Ops + product + eng | **Golden paths**, anti-patterns, scope craft, brainstorm for minimal redundant runs |
| [versioning-and-incremental.md](./versioning-and-incremental.md) | Eng + ops | **Incremental vs overwrite** tied to profile/semantic **version** history |
| [session-log.md](./session-log.md) | Claude + Cursor | **Append every working session** that touches jobs/harvest code or docs |
| [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) | Claude + Cursor | Mandatory rules for agents on this workstream |

**Guided launch:** On by default on Jobs L1. Set `NEXT_PUBLIC_JOBS_LAUNCH_WIZARD=false` only if you need to hide the wizard (rollback).

**Related (repo root / audits):**

- [../estate-jobs.md](../estate-jobs.md) — UI map and APIs  
- [../audits/harvest-job-pipeline-issues.md](../audits/harvest-job-pipeline-issues.md) — issues register  
- [../audits/harvest-job-pipeline-remediation-charter.md](../audits/harvest-job-pipeline-remediation-charter.md) — cockpit UX + phased fixes  
- [../CHANGELOG.md](../CHANGELOG.md) — repo-wide product changelog (required on every code change)
