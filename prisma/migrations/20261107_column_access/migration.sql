-- Column access by data tag and access group, plus access requests with an append-only history.
-- Design: docs/access/pii-protection-backlog.md §2b and §7 (epics E8, E9).
-- Additive only: new tables, indexes and one trigger function. Nothing existing is changed or removed.
-- `access_column_labels` stays in place, unused.

-- ── Data tags (Compensation, Medical, …) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "access_tags" (
    "id"                     TEXT NOT NULL,
    "org_id"                 TEXT NOT NULL,
    "key"                    TEXT NOT NULL,
    "name"                   TEXT NOT NULL,
    "description"            TEXT,
    "requires_two_approvals" BOOLEAN NOT NULL DEFAULT false,
    "max_duration_days"      INTEGER,
    "archived_at"            TIMESTAMPTZ(6),
    "created_by"             TEXT,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_tags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_tags_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_tags_max_duration_check"
        CHECK ("max_duration_days" IS NULL OR "max_duration_days" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_tag_org_key" ON "access_tags" ("org_id", "key");

-- ── Tags on columns ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "access_column_tags" (
    "id"          TEXT NOT NULL,
    "org_id"      TEXT NOT NULL,
    "table_path"  TEXT NOT NULL,
    "column_name" TEXT NOT NULL,
    "tag_id"      TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'confirmed',
    "source"      TEXT NOT NULL DEFAULT 'steward',
    "confidence"  DOUBLE PRECISION,
    "reason"      TEXT,
    "set_by"      TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_column_tags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_column_tags_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_column_tags_tag_id_fkey"
        FOREIGN KEY ("tag_id") REFERENCES "access_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_column_tags_status_check"
        CHECK ("status" IN ('suggested', 'confirmed', 'rejected')),
    CONSTRAINT "access_column_tags_source_check"
        CHECK ("source" IN ('rule', 'ai', 'steward', 'lineage'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_column_tag"
    ON "access_column_tags" ("org_id", "table_path", "column_name", "tag_id");
CREATE INDEX IF NOT EXISTS "idx_access_column_tags_table" ON "access_column_tags" ("org_id", "table_path");
CREATE INDEX IF NOT EXISTS "idx_access_column_tags_tag" ON "access_column_tags" ("tag_id");

-- ── Access groups (Payroll team, Medical officers, …) ────────────────────────
CREATE TABLE IF NOT EXISTS "access_groups" (
    "id"          TEXT NOT NULL,
    "org_id"      TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_by"  TEXT,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_groups_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_group_org_key" ON "access_groups" ("org_id", "key");

CREATE TABLE IF NOT EXISTS "access_group_owners" (
    "group_id" TEXT NOT NULL,
    "user_id"  TEXT NOT NULL,
    "added_by" TEXT,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_group_owners_pkey" PRIMARY KEY ("group_id", "user_id"),
    CONSTRAINT "access_group_owners_group_id_fkey"
        FOREIGN KEY ("group_id") REFERENCES "access_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_group_owners_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "access_group_members" (
    "group_id"              TEXT NOT NULL,
    "user_id"               TEXT NOT NULL,
    "expires_at"            TIMESTAMPTZ(6),
    "reason"                TEXT,
    "granted_by"            TEXT,
    "granted_by_request_id" TEXT,
    "added_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_group_members_pkey" PRIMARY KEY ("group_id", "user_id"),
    CONSTRAINT "access_group_members_group_id_fkey"
        FOREIGN KEY ("group_id") REFERENCES "access_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_group_members_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_access_group_members_user" ON "access_group_members" ("user_id");

-- ── Tag grants: group or person → tag → aggregate | full ─────────────────────
CREATE TABLE IF NOT EXISTS "access_tag_grants" (
    "id"             TEXT NOT NULL,
    "org_id"         TEXT NOT NULL,
    "tag_id"         TEXT NOT NULL,
    "principal_type" TEXT NOT NULL,
    "principal_id"   TEXT NOT NULL,
    "level"          TEXT NOT NULL,
    "expires_at"     TIMESTAMPTZ(6),
    "reason"         TEXT,
    "created_by"     TEXT,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_tag_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_tag_grants_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_tag_grants_tag_id_fkey"
        FOREIGN KEY ("tag_id") REFERENCES "access_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_tag_grants_principal_type_check"
        CHECK ("principal_type" IN ('group', 'user')),
    CONSTRAINT "access_tag_grants_level_check"
        CHECK ("level" IN ('aggregate', 'full'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_tag_grant"
    ON "access_tag_grants" ("tag_id", "principal_type", "principal_id");
CREATE INDEX IF NOT EXISTS "idx_access_tag_grants_org" ON "access_tag_grants" ("org_id");

-- ── Access requests (E9; tables only in this step) ───────────────────────────
CREATE TABLE IF NOT EXISTS "access_requests" (
    "id"                 TEXT NOT NULL,
    "seq"                BIGSERIAL NOT NULL,
    "org_id"             TEXT NOT NULL,
    "requester_id"       TEXT NOT NULL,
    "target_type"        TEXT NOT NULL,
    "tag_id"             TEXT,
    "path"               TEXT,
    "level"              TEXT NOT NULL,
    "duration_days"      INTEGER,
    "reason"             TEXT NOT NULL,
    "ticket_ref"         TEXT,
    "source_decision_id" TEXT,
    "status"             TEXT NOT NULL DEFAULT 'pending',
    "routed_to"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "decided_by"         TEXT,
    "decided_at"         TIMESTAMPTZ(6),
    "granted_until"      TIMESTAMPTZ(6),
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_requests_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_requests_tag_id_fkey"
        FOREIGN KEY ("tag_id") REFERENCES "access_tags"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "access_requests_target_check"
        CHECK (("target_type" = 'tag' AND "tag_id" IS NOT NULL) OR ("target_type" = 'path' AND "path" IS NOT NULL)),
    CONSTRAINT "access_requests_level_check"
        CHECK ("level" IN ('aggregate', 'full', 'discover', 'query', 'export')),
    CONSTRAINT "access_requests_status_check"
        CHECK ("status" IN ('pending', 'info_requested', 'approved', 'rejected', 'cancelled', 'expired')),
    CONSTRAINT "access_requests_duration_check"
        CHECK ("duration_days" IS NULL OR "duration_days" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_requests_seq" ON "access_requests" ("seq");
CREATE INDEX IF NOT EXISTS "idx_access_requests_org_created" ON "access_requests" ("org_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_access_requests_requester" ON "access_requests" ("requester_id");
CREATE INDEX IF NOT EXISTS "idx_access_requests_status" ON "access_requests" ("org_id", "status");

-- Append-only history. Every row stays in the table (D14); the UI shows up to the last 90 days.
CREATE TABLE IF NOT EXISTS "access_request_events" (
    "id"             TEXT NOT NULL,
    "org_id"         TEXT NOT NULL,
    "request_id"     TEXT NOT NULL,
    "type"           TEXT NOT NULL,
    "actor_id"       TEXT,
    "ts"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "before"         JSONB,
    "after"          JSONB,
    "comment"        TEXT,
    "ip_address"     TEXT,
    "user_agent"     TEXT,
    "policy_version" BIGINT,
    CONSTRAINT "access_request_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_request_events_request_id_fkey"
        FOREIGN KEY ("request_id") REFERENCES "access_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX IF NOT EXISTS "idx_access_request_events_org_ts" ON "access_request_events" ("org_id", "ts" DESC);
CREATE INDEX IF NOT EXISTS "idx_access_request_events_request" ON "access_request_events" ("request_id", "ts");

-- Refuse UPDATE and DELETE on the history, whoever runs them. Created only if missing.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'access_request_events_append_only') THEN
        EXECUTE $fn$
            CREATE FUNCTION access_request_events_append_only() RETURNS trigger
            LANGUAGE plpgsql AS $body$
            BEGIN
                RAISE EXCEPTION 'access_request_events is append-only';
            END;
            $body$
        $fn$;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_access_request_events_append_only'
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_access_request_events_append_only
                 BEFORE UPDATE OR DELETE ON "access_request_events"
                 FOR EACH ROW EXECUTE FUNCTION access_request_events_append_only()';
    END IF;
END $$;
