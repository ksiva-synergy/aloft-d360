# Power BI integration evaluation assets

Full guide: [`docs/powerbi-integration-validation.md`](../../docs/powerbi-integration-validation.md).

| Path | Purpose |
|------|---------|
| `suites/*.template.json` | Question-bank schema and examples (copy to `*-questions.json`) |
| `snapshot-queries.sql` | Read-only SQL for Aurora before/after counts |
| `runs/*.json` | Captured baselines and benchmark runs (**gitignored**) |

```powershell
# Platform snapshot (no DB required for file counts)
node scripts/powerbi/record-baseline-snapshot.mjs --label before-phase1

# Technical parity (Power BI vs Databricks numbers)
node --env-file=.env scripts/compare_cii_pbi_databricks.mjs

# Automated Inspector baseline (local CLI — needs VPN/RDS + Databricks)
node --env-file=.env node_modules/tsx/dist/cli.mjs -r ./scripts/context/noserver.cjs scripts/powerbi/run-cii-boost-baseline.ts --label baseline-2026-11-11

# Or admin session on running dev:
# Automated Inspector baseline (admin session, dev API)
# POST /api/inspector/boost/run-suite  { "suiteVersion": "cii_pilot_v1" }
# Then export runs to eval/powerbi/runs:
node --env-file=.env scripts/powerbi/export-cii-boost-baseline.mjs --label before-phase3
```

CII boost cases live in `src/lib/boost/suite-cii.ts` (6 prompts, `reporting_layer.ems.consumption_log`).
