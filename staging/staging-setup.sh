#!/usr/bin/env bash
# Turnkey Phase A staging verification. RUN FROM REPO ROOT:
#   cp staging/env.staging.example staging/.env.staging   # once (already present)
#   bash staging/staging-setup.sh
#
# Boots a local Postgres+pgvector, materialises the full schema, applies the
# reputation migration (idempotency rehearsal for prod), checks the neutral
# default, and runs the seeded smoke test. Touches NOTHING outside the container.
set -euo pipefail

STAGING_DIR="staging"
MIGRATION="prisma/migrations/20260713_reputation_system/migration.sql"

echo "==> [0/6] confirming the Docker daemon is actually up"
docker info >/dev/null 2>&1 || { echo "    Docker daemon is not reachable. Start Docker Desktop and wait for it to finish booting, then re-run."; exit 1; }

echo "==> [1/6] starting staging Postgres + pgvector (host port 5434)"
docker compose -f "$STAGING_DIR/docker-compose.staging.yml" up -d

echo "==> [2/6] waiting for the database to be healthy"
until [ "$(docker inspect -f '{{.State.Health.Status}}' aloft-staging-db 2>/dev/null || echo starting)" = "healthy" ]; do
  echo "    ...waiting"; sleep 2
done

echo "==> [3/6] loading staging env"
set -a; . "$STAGING_DIR/.env.staging"; set +a
echo "    DATABASE_URL -> $DATABASE_URL"

echo "==> [4/6] materialising full schema on staging (prisma db push)"
# db push builds every table from schema.prisma (incl. the reputation models),
# so the migration below becomes a pure idempotency check. The generator already
# declares previewFeatures=["postgresqlExtensions"] and extensions=[vector], so
# the Unsupported("vector") column pushes cleanly against pgvector.
npx prisma db push --skip-generate

echo "==> [5/6] applying reputation migration (should be all-idempotent no-ops)"
npx prisma db execute --file "$MIGRATION" --schema prisma/schema.prisma
echo "    verifying contributor_rep = 1.0 on all bullets (expect bad = 0):"
echo "SELECT count(*) AS bad FROM platform_agent_memory WHERE contributor_rep <> 1.0;" \
  | npx prisma db execute --schema prisma/schema.prisma --stdin

echo "==> [6/6] running seeded reputation smoke test"
npx tsx scripts/reputation-smoke.ts

echo "==> DONE. Tear down with:  docker compose -f $STAGING_DIR/docker-compose.staging.yml down -v"
