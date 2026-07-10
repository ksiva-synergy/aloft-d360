export type {
  DataDimension,
  DimensionResult,
  DimensionFn,
  DimensionInput,
  DataScoreResult,
  LevelBand,
} from './types';
export { DIMENSION_PRIORITY, LEVEL_BANDS } from './types';
export { dimensionRegistry } from './registry';
export { compositeFromDimensions, levelFromComposite, assembleDataScoreResult } from './level';
export { computeDataScore } from './compute';
export type { DataScoreInput } from './compute';
export { assembleDimensionInput } from './assemble';
export type { RawObjectData } from './assemble';
// Note: computeSourceDistribution is NOT re-exported here because distribution.ts
// uses 'server-only' and imports Prisma. Import directly from './distribution' in
// server-side code (API routes, server components).
