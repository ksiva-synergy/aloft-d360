-- Connections: S3, Azure Blob and SharePoint (docs/business-ai-studio/06-connectors-security.md).
-- New table only; nothing existing is altered or dropped. Credentials are NOT stored here: they go to
-- AWS Secrets Manager at `aloft/connections/<id>` and this table keeps only that name (secret_ref).
-- Self-service: the creator (created_by) owns a connection; `visibility` is 'private' (owner only)
-- or 'org' (everyone in the organisation may use it, only the owner or a platform admin may change it).
--
-- Apply manually via `prisma db execute --file <this> --schema ./prisma/schema.prisma`,
-- then `prisma migrate resolve --applied 20261027_connections` (same convention as 20261025_flows).
-- Rollback: DROP TABLE "platform_connections"; and delete the aloft/connections/* secrets.

CREATE TABLE IF NOT EXISTS "platform_connections" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id"         TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "kind"           TEXT NOT NULL,
    "config"         JSONB NOT NULL DEFAULT '{}',
    "secret_ref"     TEXT NOT NULL DEFAULT '',
    "status"         TEXT NOT NULL DEFAULT 'untested',
    "last_tested_at" TIMESTAMPTZ(6),
    "last_error"     TEXT,
    "created_by"     TEXT NOT NULL,
    "visibility"     TEXT NOT NULL DEFAULT 'private',
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "platform_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_connection_owner_name" ON "platform_connections" ("org_id", "created_by", "name");
CREATE INDEX IF NOT EXISTS "idx_platform_connection_org_visibility" ON "platform_connections" ("org_id", "visibility");
CREATE INDEX IF NOT EXISTS "idx_platform_connection_org_kind" ON "platform_connections" ("org_id", "kind");
