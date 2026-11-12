-- Service principal roles per Databricks connection (docs/access/data-access-architecture.md §9).
-- New table only; nothing existing is altered or dropped. Credentials are NOT stored here: they go to
-- AWS Secrets Manager at `aloft/databricks/<connection_id>/<role>` and this table keeps only that name.
-- Until a role has a row, the app uses the connection's default credential for it.
--
-- Apply manually via `prisma db execute --file <this> --schema ./prisma/schema.prisma`,
-- then `prisma migrate resolve --applied 20261105_databricks_sp_roles` (same convention as 20261027_connections).
-- Rollback: DROP TABLE "platform_databricks_credentials"; every role then uses the default credential again.

CREATE TABLE IF NOT EXISTS "platform_databricks_credentials" (
    "id"             TEXT NOT NULL,
    "connection_id"  TEXT NOT NULL,
    "role"           TEXT NOT NULL,
    "secret_ref"     TEXT NOT NULL,
    "warehouse_id"   TEXT,
    "status"         TEXT NOT NULL DEFAULT 'untested',
    "last_tested_at" TIMESTAMPTZ(6),
    "last_error"     TEXT,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "platform_databricks_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_databricks_credentials_connection_id_fkey"
        FOREIGN KEY ("connection_id") REFERENCES "platform_databricks_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_databricks_credentials_role_check"
        CHECK ("role" IN ('query_internal', 'query_confidential', 'query_restricted', 'metadata', 'profile', 'publish'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_databricks_credential_role"
    ON "platform_databricks_credentials" ("connection_id", "role");
