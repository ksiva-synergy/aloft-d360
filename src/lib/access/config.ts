import type { AccessMode, AccessSurface } from './types';

export type { AccessMode };

const VALID_MODES = new Set<AccessMode>(['off', 'observe', 'enforce']);

export function accessMode(): AccessMode {
  const raw = (process.env.ACCESS_MODE ?? 'off').trim().toLowerCase();
  if (VALID_MODES.has(raw as AccessMode)) return raw as AccessMode;
  return 'off';
}

const DEFAULT_SURFACES: AccessSurface[] = ['sql', 'semantic', 'dashboard', 'export', 'describe', 'estate'];

export function enforcedSurfaces(): Set<AccessSurface> {
  const raw = process.env.ACCESS_ENFORCE_SURFACES?.trim();
  if (!raw) return new Set(DEFAULT_SURFACES);
  const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(parts as AccessSurface[]);
}

export function isSurfaceEnforced(surface: AccessSurface): boolean {
  if (accessMode() !== 'enforce') return false;
  return enforcedSurfaces().has(surface);
}

export function shouldEvaluateAccess(): boolean {
  return accessMode() !== 'off';
}

/** Alias used by older call sites. */
export function isAccessActive(): boolean {
  return shouldEvaluateAccess();
}

export function shouldEnforceDeny(surface: AccessSurface): boolean {
  return isSurfaceEnforced(surface);
}
