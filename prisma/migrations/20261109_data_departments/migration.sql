-- Data departments: tables belong to departments; groups of people may use a department's data.
-- Additive only: three new tables. Nothing existing is altered or removed.
-- Access is derived when the policy loads (model-store.ts): each (group, department) link becomes a
-- Use rule per path that belongs to the department, so there are no copied rules to keep in sync.

CREATE TABLE IF NOT EXISTS "access_data_departments" (
    "id"          TEXT NOT NULL,
    "org_id"      TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_by"  TEXT,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_data_departments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_data_departments_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_data_department_org_key"
    ON "access_data_departments" ("org_id", "key");

CREATE TABLE IF NOT EXISTS "access_department_paths" (
    "id"            TEXT NOT NULL,
    "org_id"        TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "path"          TEXT NOT NULL,
    "path_depth"    INTEGER NOT NULL,
    "reason"        TEXT,
    "created_by"    TEXT,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_department_paths_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_department_paths_department_id_fkey"
        FOREIGN KEY ("department_id") REFERENCES "access_data_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_department_paths_path_depth_check"
        CHECK ("path_depth" BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_department_path"
    ON "access_department_paths" ("department_id", "path");
CREATE INDEX IF NOT EXISTS "idx_access_department_paths_org_path"
    ON "access_department_paths" ("org_id", "path");

CREATE TABLE IF NOT EXISTS "access_department_groups" (
    "department_id" TEXT NOT NULL,
    "group_id"      TEXT NOT NULL,
    "allow_export"  BOOLEAN NOT NULL DEFAULT false,
    "created_by"    TEXT,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "access_department_groups_pkey" PRIMARY KEY ("department_id", "group_id"),
    CONSTRAINT "access_department_groups_department_id_fkey"
        FOREIGN KEY ("department_id") REFERENCES "access_data_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_department_groups_group_id_fkey"
        FOREIGN KEY ("group_id") REFERENCES "access_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_access_department_groups_group"
    ON "access_department_groups" ("group_id");
