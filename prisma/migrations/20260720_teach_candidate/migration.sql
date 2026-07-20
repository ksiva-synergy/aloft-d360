-- ===========================================================================
-- Teach Phase 3 (capture-shape commit) — persist the typed learning envelope the
-- Reflect loop currently only EMITS over SSE (type / state / verification /
-- conflict / resolution / session), so a read-only feed can project it and a
-- future Build thread can consume a durable, typed hand-off.
--
-- WHY A COMPANION TABLE (not columns on platform_agent_memory): the hot memory
-- retrieval path (retrieve.ts selectPhase1a + appendPersonalTaughtLane) reads
-- ONLY these memory-row columns —
--     org_id, agent_class, status, rule_type, visibility, created_by,
--     rule_text, confidence, helpful_count, harmful_count, created_at
-- — so keeping the envelope in a SEPARATE table leaves that path physically
-- unchanged: the personal-taught lane reads NONE of these columns. The single
-- capture-shape effect on a memory row is a REJECTION, which reuses the
-- pre-existing status='SUPERSEDED' soft-delete the lane already filters out
-- (identical to retireMyRule) — so a rejected candidate leaves BOTH the feed and
-- recall through mechanisms that already exist. Proof obligation: the personal
-- lane returns byte-for-byte identical rows after this change, except that a
-- user-initiated rejection removes that user's own rule from their own recall.
--
-- Safe inside one transaction; idempotent via IF NOT EXISTS.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS platform_teach_candidate (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL,
    author_user_id  TEXT NOT NULL,                 -- = platform_agent_memory.created_by; the feed scopes on this (fail-closed)
    session_id      TEXT,                          -- the Teach session that captured it (workbench_sessions.id); NULL if unresolved
    memory_id       TEXT NOT NULL,                 -- 1:1 -> platform_agent_memory.id (the persisted personal rule)
    learning_type   TEXT NOT NULL,                 -- metric_definition | enterprise_convention | estate_navigation | vocabulary_entity | other
    state           TEXT NOT NULL,                 -- proposed | verified | conflict | rejected  (a 'resolved' conflict = state advanced + resolution set)
    verification    JSONB,                         -- VerificationResult; NULL until verify_claim attaches one (honest not_verifiable is stored, never fabricated)
    conflict        JSONB,                         -- ConflictInfo (existing-vs-new); NULL when no contradiction detected
    resolution      JSONB,                         -- ConflictResolution (choice, scopeNote?, resolvedAt); NULL until the user resolves
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Feed projection scopes by (org, author), newest first.
CREATE INDEX IF NOT EXISTS idx_teach_candidate_author
    ON platform_teach_candidate (org_id, author_user_id, captured_at DESC);

-- One candidate row per memory row (the envelope is 1:1 with the rule).
CREATE UNIQUE INDEX IF NOT EXISTS uq_teach_candidate_memory
    ON platform_teach_candidate (memory_id);

COMMIT;
