import 'server-only';

import { prisma } from '@/lib/db';
import type { TrajectoryEntry } from '@/lib/inspector/agent-loop';
import {
  PROGRESS_KEY,
  emptySessionKnowledge,
  formatSessionKnowledgeForPrompt,
  mergeTurnIntoSessionKnowledge,
  parseSessionKnowledge,
  type InspectorSessionKnowledge,
} from '@/lib/inspector/session-knowledge-core';

export async function loadSessionKnowledge(sessionId: string): Promise<InspectorSessionKnowledge> {
  try {
    const row = await prisma.workbench_sessions.findUnique({
      where: { id: sessionId },
      select: { progress: true },
    });
    const progress = row?.progress;
    if (!progress || typeof progress !== 'object') return emptySessionKnowledge();
    const raw = (progress as Record<string, unknown>)[PROGRESS_KEY];
    return parseSessionKnowledge(raw);
  } catch {
    return emptySessionKnowledge();
  }
}

export async function saveSessionKnowledge(
  sessionId: string,
  knowledge: InspectorSessionKnowledge,
): Promise<void> {
  const row = await prisma.workbench_sessions.findUnique({
    where: { id: sessionId },
    select: { progress: true },
  });
  if (!row) return;

  const existing =
    row.progress && typeof row.progress === 'object'
      ? (row.progress as Record<string, unknown>)
      : {};

  await prisma.workbench_sessions.update({
    where: { id: sessionId },
    data: {
      progress: {
        ...existing,
        [PROGRESS_KEY]: knowledge,
      },
      updated_at: new Date(),
    },
  });
}

export async function persistSessionKnowledgeAfterTurn(
  sessionId: string,
  trajectory: TrajectoryEntry[],
  meta: { userMessage?: string; taskGoal?: string } = {},
): Promise<void> {
  if (trajectory.length === 0) return;
  const prev = await loadSessionKnowledge(sessionId);
  const next = mergeTurnIntoSessionKnowledge(prev, trajectory, meta);
  await saveSessionKnowledge(sessionId, next);
}

export async function buildSessionKnowledgeContext(sessionId: string | undefined): Promise<string> {
  if (!sessionId) return '';
  const knowledge = await loadSessionKnowledge(sessionId);
  return formatSessionKnowledgeForPrompt(knowledge);
}
