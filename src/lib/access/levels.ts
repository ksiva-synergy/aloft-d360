import type { AccessLevel } from './types';

const RANK: Record<AccessLevel, number> = {
  discover: 1,
  query: 2,
  export: 3,
};

export function levelRank(level: AccessLevel): number {
  return RANK[level];
}

export function levelAtLeast(held: AccessLevel, needed: AccessLevel): boolean {
  return RANK[held] >= RANK[needed];
}

export function maxLevel(a: AccessLevel | null, b: AccessLevel): AccessLevel {
  if (!a) return b;
  return RANK[a] >= RANK[b] ? a : b;
}

export function compareLevels(a: AccessLevel, b: AccessLevel): number {
  return RANK[a] - RANK[b];
}
