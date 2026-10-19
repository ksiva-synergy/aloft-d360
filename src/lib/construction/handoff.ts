/**
 * Inspector → Agent Lab handoff helpers (client-safe, no DB).
 */

const SEED_KEY_PREFIX = 'aloft.workbench.seed.';

/**
 * True when a message asks to create / build / design an agent, as opposed to a
 * data question that merely mentions one ("which agent ran this query?").
 * Tolerates common typos seen in practice ("creat agent", "buld an agent").
 */
const BUILD_AGENT_RE =
  /\b(creat\w*|build\w*|buld\w*|make|making|design\w*|set ?up|setup|spin up|commission\w*|turn (?:this|it) into|new)\b[^.?!\n]{0,60}\bagents?\b/;

export function detectAgentBuildIntent(text: string): boolean {
  // The verb must come before "agent" within one clause: "build ... agent", not "agent ... new".
  return BUILD_AGENT_RE.test(text.toLowerCase());
}

/** Store the first message for a handed-off workbench session (read once by WorkbenchShell). */
export function stashWorkbenchSeed(sessionId: string, message: string): void {
  try {
    sessionStorage.setItem(SEED_KEY_PREFIX + sessionId, message);
  } catch {
    /* storage blocked — the user can retype the mission */
  }
}

/** Read and remove the seed message, so a reload never re-sends it. */
export function takeWorkbenchSeed(sessionId: string): string | null {
  try {
    const key = SEED_KEY_PREFIX + sessionId;
    const value = sessionStorage.getItem(key);
    if (value !== null) sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}
