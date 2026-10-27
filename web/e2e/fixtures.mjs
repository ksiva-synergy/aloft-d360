/**
 * API fixtures for the browser smoke test. Shapes follow the real route handlers / TypeScript types
 * (src/app/api/**, lib/foer/types.ts, lib/dashboard/summary.ts, …). They are deliberately small: the goal is
 * "the page mounts and handles a valid response", not realistic data.
 */
const NOW = new Date().toISOString();

const STATS = {
  tracedSessions: 148,
  unprocessedSessions: 1,
  totalTraceNodes: 9000,
  nodeTypeDistribution: { ACTION: 10 },
  lastTraceAt: NOW,
  activeBullets: 321,
  coreMemories: 14,
  ruleTypeDistribution: { HARD_RULE: 14, HEURISTIC: 100 },
  helpfulHarmfulRatio: 0.82,
  helpfulTotal: 312,
  harmfulTotal: 70,
  lastSynthesisAt: NOW,
  phantomsBlocked7d: 2,
  topicCount: 1,
  topics: [{ topicKey: 'vessels', topicName: 'Vessels', memberCount: 5, rank: 1 }],
  injectedLast24h: 40,
  injectedLast24hPending: false,
  lastRun: null,
  statusBuckets: { ACTIVE: 321, SUPERSEDED: 10, EXPIRED: 5, QUARANTINED: 0 },
  storeSizeSeries: [
    { date: '2026-10-16', active: 300 },
    { date: '2026-10-17', active: 321 },
  ],
  lastNRuns: [],
  flagStatus: { enabled: true, topicCoverage: 10, coveragePercent: 92, lastClusteredAt: NOW },
};

// Mirrors the PlatformContextJob row (prisma/schema.prisma).
const JOB = { id: 'job-1', org_id: 'o', source_id: null, job_kind: 'estate_inventory', trigger: 'manual', scope: {}, status: 'succeeded', started_at: NOW, finished_at: NOW, stats: {}, error: null, created_at: NOW, updated_at: NOW, child_index: null, parent_job_id: null };

// Mirrors ObjectKnowledgePayload (components/estate/ObjectKnowledgePage.tsx).
const OBJECT = {
  object: { id: 'obj-1', source_id: 's-1', object_kind: 'table', full_path: 'cat.sch.vessels', catalog_name: 'cat', schema_name: 'sch', object_name: 'vessels', native_comment: null, row_count_est: 10, size_bytes_est: 1024, last_t0_at: NOW, last_t1_at: NOW, last_t2_at: NOW, last_t3_at: NOW, last_t4_at: NOW, last_knowledge_sync_at: NOW, entity_tags: [] },
  columns: [], latestSemanticCard: null, latestSemanticStatus: null, latestSemanticId: null, latestSemanticVersion: null, hasEmbedding: false,
  profileHistory: [], freshness: { structural_as_of: NOW, profile_as_of: NOW, source_altered_at: null, stale: false, guidance: 'Fresh' },
  entityGroupObjects: [], proposedMappings: [], objectLinks: [], lastJobs: [], usageSnapshot: null, semanticModel: null,
  dataScore: {
    discoverable: { score: 0.8, reasons: [] }, accessible: { score: 0.8, reasons: [] }, trusted: { score: 0.6, reasons: [] }, actionable: { score: 0.5, reasons: [] },
    composite: 0.7, level: 'L3', gating_dimension: 'actionable',
  },
};

const DASHBOARD = {
  summary: {
    estate: { sources: 3, estateTotal: 1200, harvested: 800, profiled: 600, enriched: 400, embedded: 300, staleCount: 5, queuedJobs: 1, lastSweepAt: NOW },
    memory: { activeMemories: 320, coreMemories: 14, tracedSessions: 148, totalTraceNodes: 9000, helpfulRatio: 0.82, helpfulTotal: 312, harmfulTotal: 70, topicCount: 8, injectedLast24h: 40, phantomsBlocked7d: 2, unprocessedSessions: 1, lastSynthesisAt: NOW, injectEnabled: true, topTopics: [{ name: 'Vessels', count: 10 }], storeSeries: [1, 2, 3] },
    logins: { totalUsers: 5, activeUsers: 4, logins24h: 3, logins7d: 12, failed7d: 1, roleDistribution: [{ role: 'admin', count: 2 }], recent: [] },
    inspector: { totalSessions: 20, sessions7d: 5, totalMessages: 100, activeUsers: 3, dailyCounts: [1, 2, 3, 4, 5, 6, 7], recent: [] },
    generatedAt: NOW,
  },
  displayName: 'Test',
  roleLabel: 'Platform Admin',
  canReadUsers: true,
};

/** @returns the JSON body for an authenticated GET, or undefined to use the generic default. */
export function fixtureFor(pathname) {
  switch (pathname) {
    case '/api/dashboard/summary':
      return DASHBOARD;
    case '/api/agent-lab/context/jobs/job-1':
      return { data: JOB };
    case '/api/agent-lab/context/objects/obj-1':
      return { data: OBJECT };
    case '/api/agent-lab/context/jobs/summary':
    case '/api/agent-lab/context/jobs/queued':
      return { data: [] };
    case '/api/inspector/semantic/entities-catalog':
      return { status: 'no_governed_model' };
    case '/api/inspector/semantic/models':
      return { models: [], defaultModelId: null, isAdmin: true, currentUserId: 'u-test' };
    case '/api/inspector/teach/candidates':
      return { candidates: [], readyCount: 0, conflictCount: 0, total: 0 };
    case '/api/agent-lab/workbench/sessions':
      return { sessions: [], canReadAll: true };
    case '/api/agent-lab/memory/topic-map':
      return { topicMap: { 'sig-1': { topicKey: 'vessels', topicName: 'Vessels', rank: 1 } } };
    case '/api/agent-lab/memory/stats':
      return STATS;
    case '/api/agent-lab/memory/keeper-summary':
      return { runsCount: 0, sessionsScanned: 0, memoriesAnalyzed: 0, memoriesKept: 0, phantomsBlocked: 0, discarded: 0, windowDays: 7, bullets: [] };
    case '/api/agent-lab/memory/sessions':
      return { sessions: [] };
    case '/api/agent-lab/memory/signatures':
      return { signatures: [] };
    case '/api/agent-lab/memory/browse':
      return { bullets: [], total: 0, page: 1 };
    case '/api/agent-lab/memory/runs':
      return { runs: [], total: 0, page: 1 };
    case '/api/agent-lab/memory/job-health':
      return { jobs: [], computedAt: NOW };
    case '/api/agent-lab/memory/canary-status':
      return { fullPoolEnabled: false, fullPoolOrgs: [], mmrLambda: 0.5, mmrEnabled: false, totalActiveBullets: 321, totalHelpfulCount: 312, totalHarmfulCount: 70, attributedRuns: 5, volumeSufficient: false, computedAt: NOW };
    default:
      return undefined;
  }
}
