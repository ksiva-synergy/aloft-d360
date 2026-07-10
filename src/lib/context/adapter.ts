import type {
  ContextSource,
  ObjectRef,
  StructuralMetadata,
  ObjectProfile,
  ProfileBudget,
} from './types';

// ── Adapter capabilities ──────────────────────────────────────────────────────

export interface AdapterCapabilities {
  changeDetection: boolean;
  nativeStats: boolean;
  sampling: boolean;
}

// ── Optional opts for harvestStructure ───────────────────────────────────────
// See PHASE_CH1_DECISIONS.md D-01 for why this extends the design doc §11 signature.

export interface HarvestStructureOpts {
  queryBudget?: number;
}

// ── Core adapter interface ────────────────────────────────────────────────────

export interface ContextHarvestAdapter {
  readonly kind: 'databricks' | 'kb' | 'mcp' | 'api';

  resolveScope(source: ContextSource): Promise<ObjectRef[]>;

  detectChanges(source: ContextSource, since: Date): Promise<ObjectRef[]>;

  harvestStructure(
    refs: ObjectRef[],
    opts?: HarvestStructureOpts,
  ): Promise<StructuralMetadata[]>;

  harvestProfile(ref: ObjectRef, budget: ProfileBudget): Promise<ObjectProfile>;

  capabilities(): AdapterCapabilities;
}

// ── Error types ───────────────────────────────────────────────────────────────

export class NotImplementedError extends Error {
  constructor(methodName: string) {
    super(`${methodName} is not implemented in this adapter`);
    this.name = 'NotImplementedError';
  }
}
