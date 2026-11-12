-- Access requests extras (simplified model S4): auto-approve per access rule, and in-app notifications.
-- Additive only.

-- A request for data this rule covers is approved at once (only when the data is not protected).
ALTER TABLE "access_rules" ADD COLUMN IF NOT EXISTS "auto_approve" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "access_notifications" (
    "id"         TEXT NOT NULL,
    "org_id"     TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "kind"       TEXT NOT NULL,
    "title"      TEXT NOT NULL,
    "body"       TEXT,
    "link"       TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "read_at"    TIMESTAMPTZ(6),
    CONSTRAINT "access_notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_notifications_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "platform_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "access_notifications_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_access_notifications_user_unread"
    ON "access_notifications" ("user_id", "read_at", "created_at" DESC);
-- One notice per request, user and kind (re-running the maintenance job does not repeat it).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_access_notification_once"
    ON "access_notifications" ("request_id", "user_id", "kind");
