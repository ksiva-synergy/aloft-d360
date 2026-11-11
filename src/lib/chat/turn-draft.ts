import { prisma } from '@/lib/db';

/** Partial reply saved on the session so a dropped browser stream can catch up. */
export type TurnDraftStatus = 'running' | 'done' | 'stopped' | 'error';

export type TurnDraft = {
  status: TurnDraftStatus;
  text: string;
  at: number;
};

export function readTurnDraft(progress: unknown, field: 'inspectorDraft' | 'agentDraft'): TurnDraft | null {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null;
  const raw = (progress as Record<string, unknown>)[field];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { status, text, at } = raw as { status?: unknown; text?: unknown; at?: unknown };
  if (typeof text !== 'string') return null;
  if (status !== 'running' && status !== 'done' && status !== 'stopped' && status !== 'error') return null;
  return { status, text, at: typeof at === 'number' ? at : 0 };
}

/** Merge the draft into `progress` without dropping other keys (agent link, inspector knowledge). */
export async function writeTurnDraft(
  sessionId: string,
  field: 'inspectorDraft' | 'agentDraft',
  draft: { status: TurnDraftStatus; text: string },
): Promise<void> {
  const payload = { [field]: { status: draft.status, text: draft.text, at: Date.now() } };
  // Merge one key so a session PATCH that saves the chosen model cannot wipe the draft.
  await prisma.$executeRaw`
    UPDATE workbench_sessions
    SET progress = COALESCE(progress, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb,
        updated_at = now()
    WHERE id = ${sessionId}::uuid
  `;
}

/**
 * Throttled draft writer for one turn. `append` / `replace` save at most every 2s.
 * `finish` writes the terminal status and waits, so the poller sees the full reply.
 */
export function createDraftWriter(sessionId: string | undefined, field: 'inspectorDraft' | 'agentDraft') {
  let text = '';
  let last = 0;
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (status: TurnDraftStatus, force: boolean) => {
    if (!sessionId) return chain;
    const now = Date.now();
    if (!force && (now - last < 2000 || text.length === 0)) return chain;
    last = now;
    const snapshot = text;
    chain = chain
      .then(() => writeTurnDraft(sessionId, field, { status, text: snapshot }))
      .catch(() => {});
    return chain;
  };

  return {
    append(delta: string) {
      text += delta;
      enqueue('running', false);
    },
    replace(next: string) {
      text = next;
      enqueue('running', false);
    },
    text() {
      return text;
    },
    finish(status: TurnDraftStatus) {
      return enqueue(status, true);
    },
  };
}
