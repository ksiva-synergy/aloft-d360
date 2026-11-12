-- Data access control (docs/access/data-access-architecture.md §5).
-- New tables only. Apply via `prisma db execute --file <this> --schema ./prisma/schema.prisma`,
-- then `prisma migrate resolve --applied 20261105_data_access`.

CREATE TABLE IF NOT EXISTS "access_departments" (
    "id"              TEXT NOT NULL,
    "org_id"          TEXT NOT NULL,
    "key"             TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "entra_group_id"  TEXT,
    "archived_at"     TIMESTAMPTZ(6),
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_departments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_departments_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_department_org_key"
    ON "access_departments" ("org_id", "key");
CREATE INDEX IF NOT EXISTS "idx_access_departments_org_id"
    ON "access_departments" ("org_id");

CREATE TABLE IF NOT EXISTS "access_department_members" (
    "department_id" TEXT NOT NULL,
    "user_id"       TEXT NOT NULL,
    "source"        TEXT NOT NULL DEFAULT 'manual',
    "added_by"      TEXT,
    "added_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_department_members_pkey" PRIMARY KEY ("department_id", "user_id"),
    CONSTRAINT "access_department_members_department_id_fkey"
        FOREIGN KEY ("department_id") REFERENCES "access_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_department_members_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_department_members_source_check"
        CHECK ("source" IN ('manual', 'entra'))
);

CREATE TABLE IF NOT EXISTS "access_grants" (
    "id"              TEXT NOT NULL,
    "org_id"          TEXT NOT NULL,
    "principal_type"  TEXT NOT NULL,
    "principal_id"    TEXT NOT NULL,
    "path"            TEXT NOT NULL,
    "path_depth"      INTEGER NOT NULL,
    "level"           TEXT NOT NULL,
    "effect"          TEXT NOT NULL,
    "expires_at"      TIMESTAMPTZ(6),
    "reason"          TEXT,
    "created_by"      TEXT,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_grants_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_grants_principal_type_check"
        CHECK ("principal_type" IN ('user', 'department')),
    CONSTRAINT "access_grants_level_check"
        CHECK ("level" IN ('discover', 'query', 'export')),
    CONSTRAINT "access_grants_effect_check"
        CHECK ("effect" IN ('allow', 'deny')),
    CONSTRAINT "access_grants_path_depth_check"
        CHECK ("path_depth" >= 1 AND "path_depth" <= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_grant_principal_path_effect"
    ON "access_grants" ("principal_type", "principal_id", "path", "effect");
CREATE INDEX IF NOT EXISTS "idx_access_grants_path"
    ON "access_grants" ("path");
CREATE INDEX IF NOT EXISTS "idx_access_grants_org_id"
    ON "access_grants" ("org_id");

CREATE TABLE IF NOT EXISTS "access_labels" (
    "id"         TEXT NOT NULL,
    "org_id"     TEXT NOT NULL,
    "path"       TEXT NOT NULL,
    "path_depth" INTEGER NOT NULL,
    "label"      TEXT NOT NULL,
    "reason"     TEXT,
    "set_by"     TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_labels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_labels_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_labels_label_check"
        CHECK ("label" IN ('confidential', 'restricted')),
    CONSTRAINT "access_labels_path_depth_check"
        CHECK ("path_depth" >= 1 AND "path_depth" <= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_label_org_path"
    ON "access_labels" ("org_id", "path");

CREATE TABLE IF NOT EXISTS "access_clearances" (
    "org_id"     TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "level"      TEXT NOT NULL,
    "reason"     TEXT,
    "granted_by" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_clearances_pkey" PRIMARY KEY ("org_id", "user_id"),
    CONSTRAINT "access_clearances_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_clearances_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_clearances_level_check"
        CHECK ("level" IN ('confidential', 'restricted'))
);

CREATE TABLE IF NOT EXISTS "access_policy_version" (
    "org_id"     TEXT NOT NULL,
    "version"    BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_policy_version_pkey" PRIMARY KEY ("org_id"),
    CONSTRAINT "access_policy_version_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "access_decision_log" (
    "id"         TEXT NOT NULL,
    "ts"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "org_id"     TEXT NOT NULL,
    "user_id"    TEXT,
    "surface"    TEXT NOT NULL,
    "level"      TEXT NOT NULL,
    "paths"      TEXT[] NOT NULL DEFAULT '{}',
    "decision"   TEXT NOT NULL,
    "reason"     TEXT,
    "mode"       TEXT NOT NULL,
    "session_id" TEXT,
    "tier"       TEXT,
    CONSTRAINT "access_decision_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_decision_log_mode_check"
        CHECK ("mode" IN ('observe', 'enforce'))
);
CREATE INDEX IF NOT EXISTS "idx_access_decision_log_org_ts"
    ON "access_decision_log" ("org_id", "ts" DESC);

-- Phase 7: column-level labels (engine loads later; table created now).
CREATE TABLE IF NOT EXISTS "access_column_labels" (
    "id"          TEXT NOT NULL,
    "org_id"      TEXT NOT NULL,
    "table_path"  TEXT NOT NULL,
    "column_name" TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "reason"      TEXT,
    "set_by"      TEXT,
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_column_labels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_column_labels_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_column_labels_label_check"
        CHECK ("label" IN ('confidential', 'restricted'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_column_label_org_table_column"
    ON "access_column_labels" ("org_id", "table_path", "column_name");
