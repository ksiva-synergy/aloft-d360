import type { ObjectT2Context } from '../object-t2-context';

/** Synthetic schema cluster (2 tables) mimicking T2-enriched crewing-style data. */
export const SAMPLE_CATALOG = 'curated_db';
export const SAMPLE_SCHEMA = 'crew_ops';

export const SAMPLE_CLUSTER_CONTEXTS: ObjectT2Context[] = [
  {
    id: 'sample-obj-orders',
    full_path: 'curated_db.crew_ops.seafarer_contract',
    object_name: 'seafarer_contract',
    catalog_name: 'curated_db',
    schema_name: 'crew_ops',
    card: {
      summary: 'One row per seafarer contract assignment; links seafarers to vessels and contract terms.',
      entity: 'seafarer_contract',
      grain: 'one row per contract id',
      key_columns: ['contract_id'],
      measures: ['base_wage_usd'],
      fk_candidates: [
        { column: 'seafarer_id', likely_target: 'crew_ops.seafarer', confidence: 0.9 },
        { column: 'vessel_id', likely_target: 'crew_ops.vessel', confidence: 0.85 },
      ],
    },
    columns: [
      { name: 'contract_id', data_type: 'bigint', semantic: { role: 'key', description: 'Contract PK' } },
      { name: 'seafarer_id', data_type: 'bigint', semantic: { role: 'fk_ref', description: 'Seafarer FK' } },
      { name: 'vessel_id', data_type: 'bigint', semantic: { role: 'fk_ref', description: 'Vessel FK' } },
      { name: 'base_wage_usd', data_type: 'decimal', semantic: { role: 'measure', description: 'Monthly base wage' } },
      { name: 'start_date', data_type: 'date', semantic: { role: 'timestamp', description: 'Contract start' } },
      { name: 'status', data_type: 'string', semantic: { role: 'dimension', description: 'Active or closed' } },
    ],
  },
  {
    id: 'sample-obj-seafarer',
    full_path: 'curated_db.crew_ops.seafarer',
    object_name: 'seafarer',
    catalog_name: 'curated_db',
    schema_name: 'crew_ops',
    card: {
      summary: 'Master list of seafarers with identity and rank.',
      entity: 'seafarer',
      grain: 'one row per seafarer',
      key_columns: ['seafarer_id'],
      measures: [],
      fk_candidates: [],
    },
    columns: [
      { name: 'seafarer_id', data_type: 'bigint', semantic: { role: 'key', description: 'Seafarer PK' } },
      { name: 'full_name', data_type: 'string', semantic: { role: 'dimension', description: 'Legal name' } },
      { name: 'rank_code', data_type: 'string', semantic: { role: 'dimension', description: 'Rank' } },
      { name: 'nationality', data_type: 'string', semantic: { role: 'dimension', description: 'Country' } },
    ],
  },
];
