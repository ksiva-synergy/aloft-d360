-- ===========================================================================
-- Reputation system — Stage 1 (attribution) + Stage 2 (reputation/leaderboard)
-- + Stage 3 hook (denormalised retrieval multiplier).
--
-- Fits the existing schema:
--   - platform_agent_memory  (org-scoped bullets, keyed by org_id/agent_class/task_signature)
--   - workbench_sessions      (carries user_id)
--   - platform_memory_injections (runtime attribution rows)
--   - users
--
-- Domain axis = agent_class (stable, bounded, already in the bullet key).
-- Safe to run inside a single transaction. Idempotent-ish via IF NOT EXISTS.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- STAGE 1: Attribution / provenance
-- A bullet can have MANY contributors (it aggregates multiple source sessions),
-- so contribution is a join table, not a column on the bullet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_memory_contributions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            TEXT NOT NULL,
    memory_id         TEXT NOT NULL,                 -- FK -> platform_agent_memory.id
    user_id           TEXT NOT NULL,                 -- NextAuth user id (as stored on workbench_sessions.user_id)
    domain            TEXT NOT NULL,                 -- = agent_class of the bullet (denormalised for fast leaderboard/weighting)
    contribution_type TEXT NOT NULL,                 -- INSERT_AUTHOR | DEDUP_REINFORCE | SUPERSEDE_AUTHOR | MANUAL_CURATE
    source_session_id TEXT,                          -- workbench_sessions.id that produced it
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contrib_memory ON platform_memory_contributions (memory_id);
CREATE INDEX IF NOT EXISTS idx_contrib_user_domain ON platform_memory_contributions (org_id, user_id, domain);
-- One row per (memory, user, type): reinforcing an existing contribution is an upsert, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contrib_memory_user_type
    ON platform_memory_contributions (memory_id, user_id, contribution_type);

-- Propagate the acting user onto runtime injection rows (currently user_id stops
-- at workbench_sessions). Nullable so historical rows and anonymous runs are fine.
ALTER TABLE platform_memory_injections
    ADD COLUMN IF NOT EXISTS contributor_user_id TEXT;

-- ---------------------------------------------------------------------------
-- STAGE 2: Per-domain reputation aggregate (one row per user per domain).
-- Bayesian Beta state (pos/neg) with lazy time-decay + daily-cap bookkeeping,
-- plus a resettable season_xp for the motivational leaderboard.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_user_reputation (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    domain         TEXT NOT NULL,                    -- = agent_class
    role           TEXT NOT NULL DEFAULT 'member',   -- role prior key (see engine.ts ROLE_PRIORS)
    pos            DOUBLE PRECISION NOT NULL DEFAULT 0,   -- decayed positive evidence
    neg            DOUBLE PRECISION NOT NULL DEFAULT 0,   -- decayed negative evidence
    last_decay_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    cap_day        DATE NOT NULL DEFAULT CURRENT_DATE,     -- daily positive-cap bucket
    cap_pos_today  DOUBLE PRECISION NOT NULL DEFAULT 0,
    season_id      TEXT NOT NULL DEFAULT 'S1',
    season_xp      DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_rank      INTEGER,                          -- previous-season rank in domain (movement arrows)
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reputation_user_domain
    ON platform_user_reputation (org_id, user_id, domain);
-- Leaderboard reads: "top season_xp within (org, domain)".
CREATE INDEX IF NOT EXISTS idx_reputation_leaderboard
    ON platform_user_reputation (org_id, domain, season_xp DESC);

-- ---------------------------------------------------------------------------
-- STAGE 3 HOOK: denormalised contributor-reputation multiplier on the bullet.
-- Kept in sync on write (attribution/curate) so the hot retrieval path only
-- multiplies an existing column — no join in Phase 0/1a SQL or post-MMR rerank.
-- Defaults to 1.0 (neutral) so behaviour is unchanged until Stage 3 is enabled.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_agent_memory
    ADD COLUMN IF NOT EXISTS contributor_rep DOUBLE PRECISION NOT NULL DEFAULT 1.0;

COMMIT;
