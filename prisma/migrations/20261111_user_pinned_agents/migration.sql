-- Pinned agents: each person can pin up to 5 saved agents to their sidebar (limit enforced in the API).
-- Additive only: one new table. Nothing existing is altered or removed.

CREATE TABLE IF NOT EXISTS "user_pinned_agents" (
    "user_id"   TEXT NOT NULL,
    "agent_id"  UUID NOT NULL,
    "position"  INTEGER NOT NULL DEFAULT 0,
    "pinned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "user_pinned_agents_pkey" PRIMARY KEY ("user_id", "agent_id"),
    CONSTRAINT "user_pinned_agents_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_pinned_agents_agent_id_fkey"
        FOREIGN KEY ("agent_id") REFERENCES "agent_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "user_pinned_agents_user_id_position_idx"
    ON "user_pinned_agents" ("user_id", "position");
