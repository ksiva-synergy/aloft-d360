import type { AccessMode, AccessSurface } from './types';

export type { AccessMode };

const VALID_MODES = new Set<AccessMode>(['off', 'observe', 'enforce']);

const reported = new Set<string>();
/** Configuration problems found while reading settings; shown on the Data access page. */
const configErrors = new Map<string, string>();

/** Record a setting the app could not read (logged once per value). */
export function reportConfigError(key: string, message: string): void {
  configErrors.set(key, message);
  if (!reported.has(message)) {
    reported.add(message);
    console.error(`[access/config] ${message}`);
  }
}

export function accessConfigErrors(): string[] {
  return [...configErrors.values()];
}

/**
 * ACCESS_MODE: off | observe | enforce. Unset means off.
 * Any other value (a typo such as `enforced`) is treated as enforce, so a mistake never turns checks off.
 */
export function accessMode(): AccessMode {
  const raw = (process.env.ACCESS_MODE ?? 'off').trim().toLowerCase();
  if (VALID_MODES.has(raw as AccessMode)) {
    configErrors.delete('ACCESS_MODE');
    return raw as AccessMode;
  }
  reportConfigError('ACCESS_MODE', `ACCESS_MODE value "${raw}" is not recognised (use off, observe or enforce); enforcing.`);
  return 'enforce';
}

/**
 * ACCESS_BOOTSTRAP_OPEN=true opens every unprotected path while the org has no access rules at all.
 * It is for first setup only; without it, no rules means nothing is open.
 */
export function bootstrapOpenSetting(): boolean {
  const raw = (process.env.ACCESS_BOOTSTRAP_OPEN ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
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
