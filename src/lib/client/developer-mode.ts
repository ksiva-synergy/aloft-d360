import { hasAgentOpsRole } from '@/lib/agent-ops/role-gate';

export const DEVELOPER_MODE_STORAGE_KEY = 'aloft.developerMode';
export const DEVELOPER_MODE_CHANGED_EVENT = 'aloft-developer-mode-changed';

/** Admin and platform admin may turn on technical tool / developer UI. */
export function canUseDeveloperModeToggle(role: string | undefined | null): boolean {
  return hasAgentOpsRole(role);
}

export function readDeveloperModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDeveloperModeEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, '1');
    else localStorage.removeItem(DEVELOPER_MODE_STORAGE_KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(DEVELOPER_MODE_CHANGED_EVENT));
}

export function showDeveloperUI(role: string | undefined | null, enabled: boolean): boolean {
  return canUseDeveloperModeToggle(role) && enabled;
}
