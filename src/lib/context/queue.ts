// PHASE 3 STUB — context queue is a Phase 4 (Data Estate) concern.
//
// The Memory feature imports `embed.ts`, whose `embedQuery()` path (the only
// path Memory exercises) never touches the queue. `enqueue`/`finalize` are
// reachable only through `runEmbedJob`/`embedSubjects`, which Memory does not
// import — so they are present-in-module-but-dead-on-Memory's-paths.
//
// The signatures below are copied VERBATIM from the real
// `../aloft-platform/src/lib/context/queue.ts` (JobKind, TriggerKind, and the
// enqueue/finalize declarations) so this stub is contract-identical to the
// real file: Phase 4 replaces this file wholesale with zero type delta.
// Only the bodies differ — they throw instead of doing work.
import type { PlatformContextJob } from '@prisma/client';

export type JobKind =
  | 'change_detect'
  | 't0_structural'
  | 't1_profile'
  | 't2_semantic'
  | 'embed'
  | 'mapping'
  | 'silo_scan'
  | 't3_connected'
  | 't3_usage'
  | 'recompute_entity_tags'
  | 'estate_inventory'
  | 'knowledge_sync'
  | 't4_scan'
  | 't4_entity_propose'
  | 't4_dim_propose';

export type TriggerKind = 'scheduled' | 'on_demand' | 'on_connect';

const STUB_MESSAGE = 'context queue not available until Phase 4 (Data Estate)';

/** Insert a new queued job row and return it. */
export async function enqueue(
  jobKind: JobKind,
  sourceId: string | null,
  scope: Record<string, unknown> | null,
  trigger: TriggerKind,
  orgId: string,
): Promise<PlatformContextJob> {
  throw new Error(STUB_MESSAGE);
}

export async function finalize(
  jobId: string,
  status: 'succeeded' | 'failed' | 'partial',
  stats: Record<string, unknown>,
  error?: string,
): Promise<void> {
  throw new Error(STUB_MESSAGE);
}
