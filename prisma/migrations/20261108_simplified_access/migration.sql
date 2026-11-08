-- Simplified access model, S2 (docs/access/simplified-access-model.md §6).
-- Additive only: two new tables and one new column. Nothing existing is altered or removed;
-- the old tables (access_grants, access_labels, access_clearances, access_departments) stay readable
-- until a later, separately approved retirement step.

-- Access rules: holder → path → Use (optionally export) or Block.
CREATE TABLE IF NOT EXISTS "access_rules" (
    "id"                     TEXT NOT NULL,
    "org_id"                 TEXT NOT NULL,
    "holder_type"            TEXT NOT NULL,
    "holder_id"              TEXT NOT NULL,
    "path"                   TEXT NOT NULL,
    "path_depth"             INTEGER NOT NULL,
    "effect"                 TEXT NOT NULL,
    "allow_export"           BOOLEAN NOT NULL DEFAULT false,
    "expires_at"             TIMESTAMPTZ(6),
    "reason"                 TEXT,
    "created_by"             TEXT,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "migrated_from_grant_id" TEXT,
    CONSTRAINT "access_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_rules_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_rules_holder_type_check"
        CHECK ("holder_type" IN ('person', 'group', 'builtin')),
    CONSTRAINT "access_rules_effect_check"
        CHECK ("effect" IN ('use', 'block')),
    CONSTRAINT "access_rules_path_depth_check"
        CHECK ("path_depth" BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_rule_holder_path_effect"
    ON "access_rules" ("org_id", "holder_type", "holder_id", "path", "effect");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_rule_migrated_grant"
    ON "access_rules" ("migrated_from_grant_id");
CREATE INDEX IF NOT EXISTS "idx_access_rules_org_path" ON "access_rules" ("org_id", "path");

-- Protections on whole paths (catalog, schema or table). Column protections stay in access_column_tags.
CREATE TABLE IF NOT EXISTS "access_path_protections" (
    "id"                     TEXT NOT NULL,
    "org_id"                 TEXT NOT NULL,
    "tag_id"                 TEXT NOT NULL,
    "path"                   TEXT NOT NULL,
    "path_depth"             INTEGER NOT NULL,
    "reason"                 TEXT,
    "set_by"                 TEXT,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "migrated_from_label_id" TEXT,
    CONSTRAINT "access_path_protections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_path_protections_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_path_protections_tag_id_fkey"
        FOREIGN KEY ("tag_id") REFERENCES "access_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_path_protections_path_depth_check"
        CHECK ("path_depth" BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_path_protection"
    ON "access_path_protections" ("org_id", "tag_id", "path");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_path_protection_migrated_label"
    ON "access_path_protections" ("migrated_from_label_id");

-- Groups copied from departments keep a link back, so the copy can be re-run safely.
ALTER TABLE "access_groups" ADD COLUMN IF NOT EXISTS "migrated_from_department_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_group_migrated_department"
    ON "access_groups" ("migrated_from_department_id");
