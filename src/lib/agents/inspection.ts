import { hasAgentOpsRole } from '@/lib/agent-ops/role-gate';

/**
 * Technical note an agent records beside its reply. The person who asked sees the
 * answer. A platform admin or admin can open Inspect to read this note.
 */
export type AgentInspection = {
  sources: string;
  joins: string;
  caveats: string;
};

export const RECORD_INSPECTION_TOOL = 'record_inspection';

const FIELD_MAX = 2000;

export const INSPECTION_PROMPT = `## INSPECTION NOTE
Before the final reply, call ${RECORD_INSPECTION_TOOL} once.
- sources: the tables you queried, one fully qualified path per line.
- joins: the join you used, and whether the catalog verifies it or you assumed it.
- caveats: anything that changes how much to trust the answer, including a missing match or a placeholder value.
This note is for an administrator. Do not repeat it in the reply.`;

function field(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, FIELD_MAX) : '';
}

/** Accepts a tool payload or a saved message field. Empty notes are dropped. */
export function parseInspection(raw: unknown): AgentInspection | null {
  if (!raw || typeof raw !== 'object') return null;
  const note = raw as Record<string, unknown>;
  const sources = field(note.sources);
  const joins = field(note.joins);
  const caveats = field(note.caveats);
  if (!sources && !joins && !caveats) return null;
  return { sources, joins, caveats };
}

/** Drop the note unless the viewer is a platform admin or an admin. */
export function messagesForViewer<T extends { inspection?: AgentInspection | null }>(
  messages: T[],
  role: string | null | undefined,
): T[] {
  if (hasAgentOpsRole(role)) return messages;
  return messages.map((message) => {
    if (!message.inspection) return message;
    const copy = { ...message };
    delete copy.inspection;
    return copy;
  });
}
