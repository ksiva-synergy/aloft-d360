import type { BoostCase } from '@/lib/boost/suite';

/** Matches `eval/powerbi/suites/cii-pilot-questions.template.json` suite_id */
export const BOOST_SUITE_CII_VERSION = 'cii_pilot_v1';

/**
 * Small Inspector boost matrix for QHSE / CII — baseline before Power BI publish,
 * regression after Phase 1, uplift after Phase 3 verified queries.
 *
 * Anchor table mirrors parity SQL (`powerbi-estate/sql/cii_model_aer_2026_by_vessel.sql`).
 */
export const BOOST_SUITE_CII_PILOT: BoostCase[] = [
  {
    id: 'cii_aer_by_vessel_2026',
    title: 'Attained CII AER by vessel (2026)',
    prompt:
      'For calendar year 2026, show attained CII AER by vessel (IMO number and vessel name). ' +
      'Sort from highest AER to lowest. Use fleet consumption and distance data, not a placeholder.',
    sourceTable: 'reporting_layer.ems.consumption_log',
    taskType: 'synthesis',
    groundednessMode: 'consistency_check',
    expectedDimensions: [
      'year 2026 filter on report or activity dates',
      'AER or intensity computed from consumption and distance (not raw fuel only)',
      'grouped by vessel with IMO identifiable',
      'ranking order stated',
    ],
    difficulty: 'hard',
    joinPath: null,
    harnessStrength: 'MODERATE',
    validation: {
      domain: 'qhse',
      grain: 'vessel',
      oracle_ref: 'powerbi-estate/sql/cii_model_aer_2026_by_vessel.sql',
      pbi_measure_hint: 'AER_2026',
    },
  },
  {
    id: 'cii_fleet_aer_ytd_2026',
    title: 'Fleet attained CII AER year-to-date 2026',
    prompt:
      'What is the fleet-wide attained CII AER year to date for 2026? ' +
      'Give one headline number and briefly say how you aggregated across vessels.',
    sourceTable: 'reporting_layer.ems.consumption_log',
    taskType: 'synthesis',
    groundednessMode: 'consistency_check',
    expectedDimensions: [
      'YTD or full-year 2026 scope explicit',
      'fleet-level aggregation (not a single vessel)',
      'AER semantics, not CO2 mass alone',
    ],
    difficulty: 'hard',
    joinPath: null,
    harnessStrength: 'MODERATE',
    validation: {
      domain: 'qhse',
      grain: 'fleet',
      pbi_measure_hint: 'Attained CII / AER headline',
    },
  },
  {
    id: 'cii_co2_by_vessel_2026',
    title: 'Total CO2 by vessel (2026)',
    prompt:
      'For 2026, which vessels emitted the most CO2 from reported consumption? ' +
      'Return the top 10 vessels with IMO, name, and total CO2.',
    sourceTable: 'reporting_layer.ems.consumption_log',
    taskType: 'synthesis',
    groundednessMode: 'phantom_trace',
    expectedDimensions: [
      '2026 filter',
      'CO2 derived from fuel types or reported emissions columns',
      'top-N list with vessel identity',
    ],
    difficulty: 'medium',
    joinPath: null,
    harnessStrength: 'MODERATE',
    validation: {
      domain: 'qhse',
      grain: 'vessel',
    },
  },
  {
    id: 'cii_distance_nm_by_vessel_2026',
    title: 'Distance sailed by vessel (2026)',
    prompt:
      'For 2026, how many nautical miles did each vessel sail based on consumption reporting? ' +
      'Show vessel name, IMO, and total distance.',
    sourceTable: 'reporting_layer.ems.consumption_log',
    taskType: 'synthesis',
    groundednessMode: 'phantom_trace',
    expectedDimensions: [
      'distance columns combined correctly (observed vs HS if both present)',
      '2026 filter',
      'per-vessel totals',
    ],
    difficulty: 'medium',
    joinPath: null,
    harnessStrength: 'STRONG',
    validation: {
      domain: 'qhse',
      grain: 'vessel',
    },
  },
  {
    id: 'cii_vessels_low_distance_2026',
    title: 'Vessels with very low reported distance in 2026',
    prompt:
      'Which vessels in 2026 have suspiciously low reported distance (under 100 NM for the year) ' +
      'but non-zero fuel consumption? List them — this matters for CII data quality.',
    sourceTable: 'reporting_layer.ems.consumption_log',
    taskType: 'advisory',
    groundednessMode: 'consistency_check',
    expectedDimensions: [
      'both distance and consumption considered',
      '2026 filter',
      'quality flag rationale',
    ],
    difficulty: 'hard',
    joinPath: null,
    harnessStrength: 'MODERATE',
    validation: {
      domain: 'qhse',
      grain: 'vessel',
    },
  },
  {
    id: 'cii_rating_band_distribution',
    title: 'CII rating band distribution',
    prompt:
      'How many vessels fall in each CII rating band (A through E) for the current reporting year? ' +
      'If the warehouse cannot compute official rating bands, say what is missing.',
    sourceTable: 'reporting_layer.ems.consumption_log',
    taskType: 'advisory',
    groundednessMode: 'consistency_check',
    expectedDimensions: [
      'rating bands or refusal with explicit gap',
      'vessel counts per band if computed',
      'no invented boundaries without source',
    ],
    difficulty: 'hard',
    joinPath: null,
    harnessStrength: null,
    validation: {
      domain: 'qhse',
      grain: 'fleet',
      pbi_measure_hint: 'Rating / Required CII measures in CII SDK-2026',
    },
  },
];
