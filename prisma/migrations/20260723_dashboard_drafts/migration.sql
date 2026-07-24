-- Track B: session draft retention for the dashboard builder.
-- A mutable per-user scratch layer for uncommitted edits between Save points.
-- Separate table + separate endpoint from the immutable version chain.
--
-- Apply manually via `prisma db execute --file <this> --schema ./prisma/schema.prisma`,
-- then `prisma migrate resolve --applied 20260723_dashboard_drafts` to avoid drift
-- detection (same convention as 20260715_dashboard_connection_binding).

CREATE TABLE IF NOT EXISTS "platform_dashboard_drafts" (
    "id"              TEXT NOT NULL,
    "dashboard_id"    TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "org_id"          TEXT NOT NULL,
    "base_version_id" TEXT,
    "widgets"         JSONB NOT NULL DEFAULT '[]',
    "layouts"         JSONB NOT NULL DEFAULT '{}',
    "guided_session"  JSONB,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "platform_dashboard_drafts_pkey" PRIMARY KEY ("id")
);

-- One draft per (dashboard, user): last-write-wins upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pdd_dashboard_user"
    ON "platform_dashboard_drafts" ("dashboard_id", "user_id");

CREATE INDEX IF NOT EXISTS "idx_pdd_dashboard" ON "platform_dashboard_drafts" ("dashboard_id");
CREATE INDEX IF NOT EXISTS "idx_pdd_user"      ON "platform_dashboard_drafts" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_pdd_org"       ON "platform_dashboard_drafts" ("org_id");

-- A draft is scratch state for a live dashboard: when the dashboard is deleted the
-- draft is meaningless. FK cascade keeps the table self-cleaning (Prisma does not
-- model this relation — matching the lightweight platform_dashboard_audit table).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_pdd_dashboard'
    ) THEN
        ALTER TABLE "platform_dashboard_drafts"
            ADD CONSTRAINT "fk_pdd_dashboard"
            FOREIGN KEY ("dashboard_id") REFERENCES "platform_dashboards" ("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;
