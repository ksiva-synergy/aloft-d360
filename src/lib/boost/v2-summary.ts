export const BOOST_V2_SUMMARY = {
  totalRuns: 179,
  models: 8,
  cases: 9,
  ctxDiscoveryCalls: 0,
  completion: {
    easy:   { ctx: 0.86, sql: 0.30 },
    medium: { ctx: 0.83, sql: 0.17 },
    hard:   { ctx: 0.66, sql: 0.10 },
  },
  discoveryBurnMax: 26.2,
  callsToFirstQuery: { ctx: '1–3', sql: '6–15' },
  semanticParity: { ctxHard: 0.593, sqlHard: 0.583 },
  inversion: {
    valueModel: 'Mistral L3',
    valueHardCtx: '3/3',
    frontierModel: 'GPT-5.4',
    frontierHardSql: '1/3',
    frontierSqlTokens: '382k',
  },
} as const;
