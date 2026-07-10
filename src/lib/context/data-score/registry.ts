import type { DataDimension, DimensionFn } from './types';
import { scoreDiscoverable } from './dimensions/discoverable';
import { scoreAccessible } from './dimensions/accessible';
import { scoreTrusted } from './dimensions/trusted';
import { scoreActionable } from './dimensions/actionable';

// Registry of dimension functions keyed by dimension name.
// To redefine a dimension, replace its entry here — no other architecture changes needed.
export const dimensionRegistry: ReadonlyMap<DataDimension, DimensionFn> = new Map<DataDimension, DimensionFn>([
  ['discoverable', scoreDiscoverable],
  ['accessible', scoreAccessible],
  ['trusted', scoreTrusted],
  ['actionable', scoreActionable],
]);
