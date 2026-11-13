SELECT
  to_regclass('public.pbi_domains') IS NOT NULL AS has_pbi_domains,
  to_regclass('public.pbi_conflicts') IS NOT NULL AS has_pbi_conflicts,
  (
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pbi_models'
      AND column_name = 'domain_id'
  ) AS domain_id_type;
