-- Flows: describe-an-automation feature (see docs/flows-design.md).
-- New tables only; nothing existing is altered or dropped.
--
-- Apply manually via `prisma db execute --file <this> --schema ./prisma/schema.prisma`,
-- then `prisma migrate resolve --applied 20261025_flows` to avoid drift detection
-- (same convention as 20261017_agent_turn_loop_log).

CREATE TABLE IF NOT EXISTS "platform_flows" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id"             TEXT NOT NULL,
    "name"               TEXT NOT NULL,
    "slug"               TEXT NOT NULL,
    "owner"              TEXT NOT NULL,
    "status"             TEXT NOT NULL DEFAULT 'draft',
    "current_version_id" UUID,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "platform_flows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_flow_org_slug" ON "platform_flows" ("org_id", "slug");
CREATE INDEX IF NOT EXISTS "idx_platform_flow_org_status" ON "platform_flows" ("org_id", "status");

CREATE TABLE IF NOT EXISTS "platform_flow_versions" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "flow_id"    UUID NOT NULL,
    "version"    INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "platform_flow_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_flow_versions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "platform_flows" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_flow_version" ON "platform_flow_versions" ("flow_id", "version");

CREATE TABLE IF NOT EXISTS "platform_flow_runs" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id"       TEXT NOT NULL,
    "flow_id"      UUID NOT NULL,
    "version_id"   UUID NOT NULL,
    "trigger"      TEXT NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'queued',
    "inputs"       JSONB NOT NULL DEFAULT '{}',
    "error"        TEXT,
    "triggered_by" TEXT,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd"     DECIMAL(10,6) NOT NULL DEFAULT 0,
    "started_at"   TIMESTAMPTZ(6),
    "finished_at"  TIMESTAMPTZ(6),
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "platform_flow_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_flow_runs_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "platform_flows" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_flow_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "platform_flow_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_platform_flow_run_org_status" ON "platform_flow_runs" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "idx_platform_flow_run_flow_created" ON "platform_flow_runs" ("flow_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "platform_flow_step_runs" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id"      UUID NOT NULL,
    "step_id"     TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "attempt"     INTEGER NOT NULL DEFAULT 0,
    "output"      JSONB,
    "error"       TEXT,
    "llm_call_id" TEXT,
    "started_at"  TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    CONSTRAINT "platform_flow_step_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_flow_step_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "platform_flow_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_flow_step_run" ON "platform_flow_step_runs" ("run_id", "step_id");
