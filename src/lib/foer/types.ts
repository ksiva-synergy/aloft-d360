// Shared types for the FOER (Foundation for Executable Agent Reflection) layer.

export interface FoerBullet {
  id: string;
  agentClass: string;
  taskSignature: string | null;
  ruleText: string;
  ruleType: string;
  blurb: string | null;
  helpfulCount: number;
  harmfulCount: number;
  confidence: number;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface FoerSession {
  sessionId: string;
  agentClass: string | null;
  nodeCount: number;
  lastNodeAt: string;
}

export interface FoerTopic {
  topicKey: string;
  topicName: string;
  memberCount: number;
  rank: number;
}

export interface LastRunInfo {
  id: string;
  sessionsScanned: number;
  sessionsReflected: number;
  sessionsSkipped: number;
  bulletsInserted: number;
  bulletsDeduped: number;
  bulletsSuperseded: number;
  phantomsBlocked: number;
  bulletsQuarantined: number;
  reflectorVersion: string | null;
  completedAt: string;
}

export interface StatsResponse {
  tracedSessions: number;
  unprocessedSessions: number;
  totalTraceNodes: number;
  nodeTypeDistribution: Record<string, number>;
  lastTraceAt: string | null;
  activeBullets: number;
  coreMemories: number;
  ruleTypeDistribution: Record<string, number>;
  helpfulHarmfulRatio: number;
  helpfulTotal: number;
  harmfulTotal: number;
  lastSynthesisAt: string | null;
  phantomsBlocked7d: number;
  topicCount: number;
  topics: FoerTopic[];
  injectedLast24h: number | null;
  injectedLast24hPending: boolean;
  lastRun: LastRunInfo | null;
  statusBuckets: { ACTIVE: number; SUPERSEDED: number; EXPIRED: number; QUARANTINED: number };
  storeSizeSeries: { date: string; active: number }[];
  lastNRuns: LastRunInfo[];
  flagStatus: { enabled: boolean; topicCoverage: number; coveragePercent: number; lastClusteredAt: string | null };
}

