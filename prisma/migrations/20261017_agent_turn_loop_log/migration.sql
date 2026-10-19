-- Agent Ops: server-side turn + per-loop metrics (turn timing, TTFT, LLM vs tool time,
-- prompt-cache tokens, context growth). Also links tool_invocation_log.run_id to turn_id.
--
-- Apply manually via `prisma db execute --file <this> --schema ./prisma/schema.prisma`,
-- then `prisma migrate resolve --applied 20261017_agent_turn_loop_log` to avoid drift
-- detection (same convention as 20260723_dashboard_drafts).

CREATE TABLE IF NOT EXISTS "agent_turn_log" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "turn_id"            TEXT NOT NULL,
    "session_id"         TEXT NOT NULL,
    "surface"            TEXT NOT NULL,
    "model"              TEXT,
    "started_at"         TIMESTAMPTZ(6) NOT NULL,
    "duration_ms"        INTEGER NOT NULL,
    "first_token_ms"     INTEGER,
    "llm_ms"             INTEGER NOT NULL DEFAULT 0,
    "tool_ms"            INTEGER NOT NULL DEFAULT 0,
    "loops"              INTEGER NOT NULL DEFAULT 0,
    "tool_calls"         INTEGER NOT NULL DEFAULT 0,
    "tool_errors"        INTEGER NOT NULL DEFAULT 0,
    "input_tokens"       INTEGER NOT NULL DEFAULT 0,
    "output_tokens"      INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens"  INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "peak_context_chars" INTEGER NOT NULL DEFAULT 0,
    "outcome"            TEXT NOT NULL,
    "error"              TEXT,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "agent_turn_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_turn_log_turn_id_key" ON "agent_turn_log" ("turn_id");
CREATE INDEX IF NOT EXISTS "idx_agent_turn_log_session" ON "agent_turn_log" ("session_id", "started_at");

CREATE TABLE IF NOT EXISTS "agent_loop_log" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "turn_id"            TEXT NOT NULL,
    "session_id"         TEXT NOT NULL,
    "loop"               INTEGER NOT NULL,
    "model"              TEXT,
    "started_at"         TIMESTAMPTZ(6) NOT NULL,
    "llm_ms"             INTEGER NOT NULL,
    "first_token_ms"     INTEGER,
    "tool_ms"            INTEGER NOT NULL DEFAULT 0,
    "input_tokens"       INTEGER NOT NULL DEFAULT 0,
    "output_tokens"      INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens"  INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "context_messages"   INTEGER NOT NULL DEFAULT 0,
    "context_chars"      INTEGER NOT NULL DEFAULT 0,
    "tool_calls"         INTEGER NOT NULL DEFAULT 0,
    "stop_reason"        TEXT,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "agent_loop_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_agent_loop_log_session" ON "agent_loop_log" ("session_id", "turn_id", "loop");
