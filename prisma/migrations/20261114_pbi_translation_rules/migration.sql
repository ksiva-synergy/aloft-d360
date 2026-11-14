-- Power BI → SQL rule registry: DAX / Power Query function translations as SQL templates,
-- synthesized (LLM) or seeded, and verified by differential testing against Power BI.

CREATE TABLE IF NOT EXISTS pbi_translation_rules (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         TEXT         NOT NULL,
  kind           TEXT         NOT NULL,              -- dax_fn | m_fn
  name           TEXT         NOT NULL,              -- function name (DAX upper-case, M as written)
  arity          INTEGER      NOT NULL,              -- number of arguments the template takes
  sql_template   TEXT         NOT NULL,              -- Spark SQL with {0}..{n-1} placeholders
  result_kind    TEXT         NOT NULL DEFAULT 'unknown',
  status         TEXT         NOT NULL DEFAULT 'candidate', -- candidate | verified | promoted | rejected
  source         TEXT         NOT NULL DEFAULT 'llm',       -- llm | seed | human
  arg_specs      JSONB        NOT NULL DEFAULT '[]',        -- test input specs per argument
  evidence       JSONB        NOT NULL DEFAULT '{}',        -- differential test cases and results
  model_used     TEXT,
  prompt_version TEXT,
  attempts       INTEGER      NOT NULL DEFAULT 0,
  verified_at    TIMESTAMPTZ(6),
  promoted_by    TEXT,
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pbi_translation_rules_key
  ON pbi_translation_rules (org_id, kind, name, arity);
CREATE INDEX IF NOT EXISTS idx_pbi_translation_rules_status
  ON pbi_translation_rules (org_id, status);
