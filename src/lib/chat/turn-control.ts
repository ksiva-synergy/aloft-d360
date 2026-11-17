/**
 * Explicit Stop for a chat turn. Closing the browser tab, switching tabs, or leaving the page
 * drops the HTTP stream; that must not cancel the model. Only this flag does.
 * One Node process (dev server, Elastic Beanstalk instance) shares these maps.
 *
 * Each turn may carry a client `turnId`. Stop flags are then keyed per turn, so "stop the old
 * reply and send this one now" cannot stop the new turn (a late cancel) or leave the old one
 * running (the new turn clearing a chat-wide flag). Without a turnId the flag is chat-wide.
 */

type ChatKind = 'inspector' | 'agent';

/** Stop flags with the time they were set, pruned after an hour (a cancel for a finished turn). */
const stopped = new Map<string, number>();
/** The newest turn per chat. Older turns stop writing the shared draft once a newer one starts. */
const latestTurn = new Map<string, string>();
/** Settles when the chat's running turn ends; a forced follow-up waits on it. */
const running = new Map<string, { turnId: string; done: Promise<void> }>();

const STOP_TTL_MS = 60 * 60 * 1000;
const TURN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function pruneStops(now: number) {
  for (const [key, at] of stopped) {
    if (now - at > STOP_TTL_MS) stopped.delete(key);
  }
}

export function turnStopKey(kind: ChatKind, id: string, turnId?: string): string {
  const chatKey = `${kind}:${id}`;
  return turnId ? `${chatKey}:${turnId}` : chatKey;
}

/** A client turn id from a request body, or undefined when missing or malformed. */
export function parseTurnId(raw: unknown): string | undefined {
  return typeof raw === 'string' && TURN_ID_RE.test(raw) ? raw : undefined;
}

export function requestTurnStop(key: string): void {
  if (!key) return;
  const now = Date.now();
  pruneStops(now);
  stopped.set(key, now);
}

export function isTurnStopped(key: string): boolean {
  return key.length > 0 && stopped.has(key);
}

export function clearTurnStop(key: string): void {
  stopped.delete(key);
}

export type OpenTurn = {
  stopKey: string;
  /**
   * Stop pressed for this turn, or a chat-wide Stop (a client that does not know the turn id,
   * such as a page reloaded mid-reply). Chat-wide flags are cleared when each turn opens.
   */
  isStopped: () => boolean;
  /** True while no newer turn has started on this chat. */
  isCurrent: () => boolean;
  /** Call once when the turn ends (also when it fails). */
  end: () => void;
};

/** Register a running turn. `id` is the session or chat id; empty means a stateless turn. */
export function openTurn(kind: ChatKind, id: string | null | undefined, turnId?: string): OpenTurn {
  if (!id) return { stopKey: '', isStopped: () => false, isCurrent: () => true, end: () => {} };
  const chatKey = turnStopKey(kind, id);
  const stopKey = turnStopKey(kind, id, turnId);
  const marker = turnId ?? `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  clearTurnStop(chatKey);
  clearTurnStop(stopKey);
  latestTurn.set(chatKey, marker);

  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  running.set(chatKey, { turnId: marker, done });

  let ended = false;
  return {
    stopKey,
    isStopped: () => isTurnStopped(stopKey) || (stopKey !== chatKey && isTurnStopped(chatKey)),
    isCurrent: () => latestTurn.get(chatKey) === marker,
    end: () => {
      if (ended) return;
      ended = true;
      if (turnId) clearTurnStop(stopKey);
      if (running.get(chatKey)?.turnId === marker) running.delete(chatKey);
      if (latestTurn.get(chatKey) === marker) latestTurn.delete(chatKey);
      resolveDone();
    },
  };
}

/**
 * Wait for the chat's running turn to end, at most `timeoutMs`. Used when a new message arrives
 * while a stopped reply is still saving, so the new turn reads history that includes it.
 * Returns true when no turn was running or it ended in time.
 */
export async function waitForTurnIdle(kind: ChatKind, id: string, timeoutMs: number): Promise<boolean> {
  const current = running.get(turnStopKey(kind, id));
  if (!current) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([current.done.then(() => true as const), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
