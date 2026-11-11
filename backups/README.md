# Database backups (local only — gitignored)

Before applying `prisma/migrations/20261111_powerbi_bridge_phase1/migration.sql`:

```powershell
# From repo root (uses DATABASE_URL from .env; never prints the URL)
node --env-file=.env scripts/backup-postgres.mjs backups
```

Retries on connection timeout / reset (default **12** attempts, **5s** apart):

```powershell
$env:PG_DUMP_RETRY_ATTEMPTS = "20"
$env:PG_DUMP_RETRY_DELAY_MS = "8000"
node --env-file=.env scripts/backup-postgres.mjs backups
```

Tries, in order:

1. `pg_dump` on PATH  
2. Windows: `C:\Program Files\PostgreSQL\*\bin\pg_dump.exe`  
3. Docker Desktop running → `postgres:18-alpine` (bind-mounts the output dir; writes `-f /out/<file>.dump` — do not rely on stdout from the container on Windows)

If all fail, install the client (`winget install PostgreSQL.PostgreSQL.17`) or start Docker Desktop.

**Prisma URLs:** the script strips `?schema=public` and uses `pg_dump -h …` flags (pg_dump cannot take Prisma's full URI).

**Postgres 18 on Aurora:** dev uses server **18.x**; local `pg_dump` **16.x** will fail with *server version mismatch*. The script then uses **Docker `postgres:18-alpine`** (start Docker Desktop) or install PostgreSQL **18** client tools.

**Aurora not reachable from your PC:** if you see `Connection timed out`, your machine cannot reach the RDS writer (security group / network path required — retries help only when the link is flaky, not fully blocked). Options:

- Connect VPN / get your IP allowed on the Aurora security group, then re-run the script.
- Run the same command from a host that already runs the app or harvester (e.g. jump box, CI with DB access).
- Ask cloud ops for an **RDS snapshot** before applying the Power BI migration (alternative to `pg_dump`).

Restore (operators only):

```powershell
pg_restore -d $DATABASE_URL --clean --if-exists backups/pre-powerbi-bridge-YYYYMMDD.dump
```
