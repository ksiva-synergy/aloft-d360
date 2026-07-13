-- Runs once on first container boot (docker-entrypoint-initdb.d).
-- pgvector is required because platform_agent_memory has a vector embedding
-- column. pgcrypto is harmless on PG16 (gen_random_uuid is core) but kept for
-- parity with environments on older Postgres.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
