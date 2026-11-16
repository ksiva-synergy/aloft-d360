import type { Tone } from '@/components/estate/object-ui';
import type { MeasureRecreationStage } from '@/lib/powerbi/recreation-summary';

export const PATTERN_LABEL: Record<string, string> = {
  compiler_blowup: 'SQL blow-up',
  slow_plan: 'slow Databricks planning',
  validation_deferred: 'validated at parity',
  pq_capability_gap: 'Power Query step not modeled',
  dax_capability_gap: 'DAX function not modeled',
  scale_mismatch: 'scale ×100/×1000',
  sign_flip: 'sign flipped',
  row_fanout: 'row fan-out',
  empty_sql_result: 'SQL empty',
  blank_mismatch: 'Power BI BLANK',
  boundary_rows: 'few rows differ',
  type_mismatch: 'text vs number',
  cast_error: 'bad value in numeric column',
  slice_mismatch: 'members differ (total matches)',
};

export const ROOT_CAUSE_LABEL: Record<string, string> = {
  empty_dax: 'empty DAX',
  ui_slicer_helper: 'slicer helper',
  text_result: 'text result',
  nondeterministic_source: 'non-deterministic in PBI',
  unsupported_dax: 'DAX not modeled',
  harvest_gap: 'harvest gap',
  replica_drift: 'replica schema drift',
  source_not_in_warehouse: 'source not in warehouse',
  rls_required: 'needs RLS identity',
  unbound_table: 'unbound table',
  pq_unsupported: 'Power Query step',
  warehouse_error: 'warehouse error',
  engine_limit: 'Spark planning limit',
  warehouse_timeout: 'time budget exceeded',
  warehouse_unavailable: 'warehouse unavailable',
  llm_failed: 'LLM failed',
  data_freshness: 'dataset stale',
  parity_mismatch: 'value mismatch',
  parity_no_oracle: 'no oracle value',
  not_translated: 'not translated',
};

export const RECREATION_STAGE_META: Record<
  MeasureRecreationStage,
  { label: string; tone: Tone; hint: string }
> = {
  published: {
    label: 'Published',
    tone: 'green',
    hint: 'Parity passed and a verified query is in the knowledge base.',
  },
  recreated: {
    label: 'Recreated',
    tone: 'green',
    hint: 'Databricks SQL matches Power BI oracle within tolerance; not published yet.',
  },
  stale: {
    label: 'Dataset stale',
    tone: 'amber',
    hint: 'Differs only because the Power BI dataset is older than the warehouse (tables it reads changed since the refresh). Stays published, flagged; re-checked after the next refresh — fails if it still differs after two.',
  },
  regressed: {
    label: 'Regressed',
    tone: 'red',
    hint: 'Matched Power BI before, no longer does. Demoted from the knowledge base unless only the dataset is stale.',
  },
  parity_fail: { label: 'Mismatch', tone: 'red', hint: 'SQL ran but number differs from Power BI.' },
  parity_error: { label: 'SQL error', tone: 'red', hint: 'Warehouse rejected the translated SQL (often wrong columns).' },
  parity_skip: { label: 'Parity skipped', tone: 'amber', hint: 'Missing oracle or warehouse context.' },
  draft_sql: { label: 'Draft SQL', tone: 'blue', hint: 'Translation exists; parity not completed.' },
  no_sql: { label: 'No SQL', tone: 'amber', hint: 'UC bound but translate did not produce SQL.' },
  no_uc: { label: 'No UC', tone: 'neutral', hint: 'Cannot map measure to a Unity Catalog table.' },
};