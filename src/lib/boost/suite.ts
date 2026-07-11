export type BoostCase = {
  id: string;
  title: string;
  prompt: string;
  sourceTable: string;
  sourceTables?: string[];
  taskType: 'synthesis' | 'advisory';
  groundednessMode?: 'phantom_trace' | 'consistency_check';
  expectedDimensions: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  joinPath?: {
    tables: string[];
    keys: string[];
  } | null;
  harnessStrength?: 'STRONG' | 'MODERATE' | null;
  // AM2.2 — which agent class's memory bullets to retrieve for this case.
  // Defaults to 'feynman' in the runner when absent (highest-volume synthesis class).
  agentClass?: string;
};

export const BOOST_SUITE_VERSION = 'boost_suite_v2';

export const BOOST_SUITE_V1: BoostCase[] = [
  {
    id: 'crew_synthesis_90d',
    title: 'Crew Movement Synthesis (90 days)',
    prompt:
      'Summarise crew movements across the fleet over the past 90 days. ' +
      'Break down by rank, port of embarkation, vessel, nationality, and distribution pattern.',
    sourceTable: 'backfill_staging_wage_accounts',
    taskType: 'synthesis',
    groundednessMode: 'phantom_trace',
    expectedDimensions: ['rank', 'port', 'vessel', 'nationality', 'distribution'],
  },
  {
    id: 'contract_expiry_alert',
    title: 'Contract Expiry Alert',
    prompt:
      'Identify all crew members whose contracts expire within the next 30 days. ' +
      'Group by vessel and rank, flag any vessel with more than 3 simultaneous expiries.',
    sourceTable: 'backfill_staging_wage_accounts',
    taskType: 'synthesis',
    groundednessMode: 'phantom_trace',
    expectedDimensions: ['vessel', 'rank', 'expiry_date', 'crew_count', 'risk_flag'],
  },
  {
    id: 'vessel_utilisation_rollup',
    title: 'Vessel Utilisation Rollup',
    prompt:
      'Compute monthly vessel utilisation rates for the fleet. ' +
      'Show days_at_sea vs days_in_port ratio, average crew complement, and cost per day.',
    sourceTable: 'backfill_staging_wage_accounts',
    taskType: 'synthesis',
    groundednessMode: 'phantom_trace',
    expectedDimensions: ['vessel', 'month', 'days_at_sea', 'days_in_port', 'utilisation_pct', 'cost_per_day'],
  },
  {
    id: 'fleet_renewal_assessment',
    title: 'Fleet Renewal Risk Assessment',
    prompt: 'Based on the vessel particulars data, which vessel categories show aging fleet risk? What renewal and modernization patterns do you see? Give me a detailed assessment with supporting evidence from the data.',
    sourceTable: 'reporting_layer.vessel_portal.vessel_particulars',
    taskType: 'advisory',
    groundednessMode: 'consistency_check',
    expectedDimensions: ['vessel_age_distribution', 'category_risk_ranking', 'renewal_patterns', 'modernization_evidence'],
  },
  {
    id: 'crew_rotation_risk',
    title: 'Crew Rotation Imbalance Risk',
    prompt: 'Looking at crew contract movements over the last 90 days, are there any nationalities or rank levels showing imbalanced sign-on vs sign-off ratios that could indicate retention risk? Identify specific risk areas with data.',
    sourceTable: 'open_analytics_zone.ks_scratchpad.crew_contracts_data',
    taskType: 'advisory',
    groundednessMode: 'consistency_check',
    expectedDimensions: ['nationality_imbalance', 'rank_imbalance', 'retention_risk_flags', 'data_evidence'],
  },
  {
    id: 'crew_onboard_enriched_profile',
    title: 'Crew-on-Board Enriched Profile (multi-table)',
    prompt:
      'For the top 10 vessels by crew movement volume in the last 90 days, give me an enriched profile: ' +
      'how many crew are currently on board (signed on with no subsequent sign-off), what are their ranks and nationalities, ' +
      'what is the average remaining contract duration, and what are the vessel characteristics (type, build year, flag, deadweight). ' +
      'Identify any vessels where more than 30% of on-board crew contracts expire within 60 days — ' +
      'these are the high-renewal-risk vessels. Cross-reference crew contracts with vessel particulars for the full picture.',
    sourceTable: 'open_analytics_zone.ks_scratchpad.crew_contracts_data',
    sourceTables: [
      'open_analytics_zone.ks_scratchpad.crew_contracts_data',
      'open_analytics_zone.ks_scratchpad.contracts_raw_info_full',
      'reporting_layer.vessel_portal.vessel_particulars',
    ],
    taskType: 'synthesis',
    groundednessMode: 'phantom_trace',
    expectedDimensions: [
      'top_vessels_by_movement',
      'onboard_crew_count',
      'rank_nationality_breakdown',
      'avg_remaining_contract_days',
      'vessel_characteristics',
      'contract_expiry_risk_flag',
    ],
  },
];

export const BOOST_SUITE_V2: BoostCase[] = [
  // ── EASY ──────────────────────────────────────────────────────────────
  {
    id: 'cost_exposure_by_vessel',
    title: 'Committed-cost exposure by vessel',
    prompt:
      "What's our current total committed-cost exposure, broken down by vessel? " +
      "Give me the vessels carrying the most.",
    sourceTable: 'reporting_layer.finance.committed_cost_report_v12',
    taskType: 'synthesis',
    expectedDimensions: [
      'canonical report version used (v12, not v1–v11 or _prod/_new/_kaas variants)',
      'aggregation grouped by vessel (imo_no / vessel_name)',
      'total exposure summed correctly',
      'top vessels surfaced and ranked',
    ],
    difficulty: 'easy',
    joinPath: null,
    harnessStrength: 'STRONG',
  },
  {
    id: 'onboard_crew_by_vessel',
    title: 'Current onboard crew headcount',
    prompt:
      "How many crew are currently onboard each of our vessels right now?",
    sourceTable:
      'reporting_layer.sac_prod_seafarer_public.onboarded_crew_with_beneficiary',
    taskType: 'synthesis',
    expectedDimensions: [
      'used the currently-onboard source, not a roster/history/relief view',
      'count grouped by vessel (imo_number / vessel_name)',
      'no double-count of off-signers or planned reliefs',
    ],
    difficulty: 'easy',
    joinPath: null,
    harnessStrength: 'MODERATE',
  },
  {
    id: 'managed_fleet_by_flag',
    title: 'Managed vessel count by flag state',
    prompt:
      "How many vessels do we currently manage under each flag state?",
    sourceTable: 'reporting_layer.finance.vessel_master',
    // was: 'curated_db.vessel_scorecard.vessel_master' — empty, scorecard pipeline not yet run
    taskType: 'synthesis',
    expectedDimensions: [
      'authoritative vessel master chosen (not vessel_accounts/finance/crp master)',
      'count grouped by flag',
      'active vessels only (latest record per vessel_code)',
    ],
    difficulty: 'easy',
    joinPath: null,
    harnessStrength: 'STRONG',
  },
  {
    id: 'hull_performance_snapshot',
    title: 'Latest hull performance across the fleet',
    prompt:
      "Give me the current hull-performance picture for the fleet — " +
      "which vessels are trending worst?",
    sourceTable: 'curated_db.digital_desk.hull_performance',
    taskType: 'synthesis',
    expectedDimensions: [
      'base hull_performance used, not _six_months/_profile/_drift/_summary variant',
      'latest snapshot per vessel (max created_at)',
      'correct performance metric identified among 62 columns',
      'worst-trending vessels ranked',
    ],
    difficulty: 'easy',
    joinPath: null,
    harnessStrength: 'MODERATE',
  },

  // ── MEDIUM ────────────────────────────────────────────────────────────
  // env_kpi_decode: blocked — vessel_kpi_data + vsc_kpi_items empty until
  // scorecard pipeline backfill. Replaced in active matrix by cost_by_technical_manager.
  {
    id: 'env_kpi_decode',
    title: 'Worst environmental KPIs, named not coded',
    prompt:
      "Which vessels are performing worst on environmental KPIs this quarter? " +
      "Show me the actual KPI names, not internal codes.",
    sourceTable: 'curated_db.vessel_scorecard.vessel_kpi_data',
    taskType: 'synthesis',
    expectedDimensions: [
      'kpi_item_code resolved to human KPI name via the items dimension',
      'filtered to environment KPIs only (not cost/safety/reliability/ops)',
      'per-vessel scoring within the quarter',
      'worst performers ranked with named KPIs',
    ],
    difficulty: 'medium',
    joinPath: {
      tables: [
        'curated_db.vessel_scorecard.vessel_kpi_data',
        'curated_db.vessel_scorecard.vsc_kpi_items',
      ],
      keys: ['kpi_item_code'],
    },
    harnessStrength: 'STRONG',
  },
  {
    id: 'crew_competency_vs_fleet',
    title: 'Vessels staffed below competency average',
    prompt:
      "Which vessels are currently crewed by people whose competency scores " +
      "sit below the fleet average?",
    sourceTable: 'curated_db.crew_scorecard.crew_vessel',
    taskType: 'synthesis',
    expectedDimensions: [
      'current crew-vessel assignment resolved',
      'competency joined on crew identity',
      'fleet-average computed as comparison baseline',
      'vessels below baseline identified',
    ],
    difficulty: 'medium',
    joinPath: {
      tables: [
        'curated_db.crew_scorecard.crew_vessel',
        'curated_db.crew_scorecard.vw_csi_competency',
      ],
      keys: ['crew_code'],
    },
    harnessStrength: 'MODERATE',
  },
  {
    id: 'cost_by_technical_manager',
    title: 'Committed cost by technical manager',
    prompt:
      "Break our committed costs down by technical manager — who's responsible " +
      "for the most expensive vessels?",
    sourceTable: 'reporting_layer.finance.committed_cost_report_v12',
    taskType: 'synthesis',
    expectedDimensions: [
      'cost report joined to vessel master on the IMO key',
      'technical manager (TM_MAIL_ID) attributed per vessel',
      'cost aggregated by manager',
      'managers ranked by total cost owned',
    ],
    difficulty: 'medium',
    joinPath: {
      tables: [
        'reporting_layer.finance.committed_cost_report_v12',
        'reporting_layer.finance.vessel_master',
      ],
      keys: ['imo_no'],
    },
    harnessStrength: 'STRONG',
  },

  // ── HARD ──────────────────────────────────────────────────────────────
  {
    id: 'voyage_efficiency_to_cost',
    title: 'Fuel-inefficient voyages and what they cost',
    prompt:
      "For our least fuel-efficient voyages last quarter, what did they actually " +
      "cost us — and is there a pattern by trade route?",
    sourceTable: 'curated_db.digital_desk.navtor_voyage_reports_parsed',
    taskType: 'synthesis',
    expectedDimensions: [
      'voyage efficiency derived from the performance table',
      'voyage matched to cost across catalogs via IMO + voyage key',
      'route pattern (from/to port) analysed',
      'cross-catalog IMO key heterogeneity resolved (imo_no vs vessel_imo)',
    ],
    difficulty: 'hard',
    joinPath: {
      tables: [
        'curated_db.digital_desk.navtor_voyage_reports_parsed',
        'reporting_layer.voyage_optimization.vo_final_performance_tbl',
        'reporting_layer.finance.committed_cost_report_v12',
      ],
      keys: ['imo_no↔vessel_imo', 'voyage_number'],
    },
    harnessStrength: 'STRONG',
  },
  {
    id: 'crew_quality_to_safety',
    title: 'Does crew competency track safety outcomes?',
    prompt:
      "Do the vessels we staff with lower-competency crew also show worse safety " +
      "inspection outcomes? I want to know if there's a real link.",
    sourceTable: 'curated_db.crew_scorecard.crew_vessel',
    taskType: 'advisory',
    expectedDimensions: [
      'crew competency aggregated to vessel level',
      'safety/inspection outcomes joined across catalogs',
      'crew-to-vessel-to-QHSE identity chain resolved',
      'correlation stated with appropriate epistemic limits',
    ],
    difficulty: 'hard',
    joinPath: {
      tables: [
        'curated_db.crew_scorecard.crew_vessel',
        'curated_db.crew_scorecard.vw_csi_competency',
        'reporting_layer.qhse.bi_vw_vir_inspection',
      ],
      keys: ['crew_code', 'vessel_imo↔IMO_NO'],
    },
    harnessStrength: 'STRONG',
  },
  {
    id: 'opex_overspend_meets_risk',
    title: 'Opex overspend coinciding with safety risk',
    prompt:
      "Where are we overspending on opex AND carrying poor safety performance on " +
      "the same vessels? Give me a focus list for management this quarter.",
    sourceTable: 'open_analytics_zone.vom.opex_dataset',
    taskType: 'advisory',
    expectedDimensions: [
      'opex exceptions identified (EXCEPTION_FLAG semantics applied correctly)',
      'PSC/safety performance joined across catalogs via IMO_NO',
      'vessels appearing on both dimensions intersected',
      'prioritised focus list with per-vessel rationale',
    ],
    difficulty: 'hard',
    joinPath: {
      tables: [
        'open_analytics_zone.vom.opex_dataset',
        'reporting_layer.qhse.synergypool_vw_psc_performance',
        'reporting_layer.finance.committed_cost_report_v12',
      ],
      keys: ['IMO_NO', 'imo_no'],
    },
    harnessStrength: 'STRONG',
  },
];
