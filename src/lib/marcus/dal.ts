import { prisma } from '@/lib/prisma';
import { createId } from '@paralleldrive/cuid2';
import { getDefaultOrg } from '@/lib/org';
import type { TriggerType, Technique, Severity, ReflectionStatus, SuggestedAction, SubjectKind } from './types';

export interface CreateReflectionInput {
  sessionId:      string;
  subjectKind?:   SubjectKind;
  turnIndex?:     number;
  triggerType:    TriggerType;
  technique:      Technique;
  headline:       string;
  body:           string;
  suggestedAction?: SuggestedAction | null;
  severity:       Severity;
  status:         ReflectionStatus;
  stateSnapshot?: Record<string, unknown>;
  promptVersion:  string;
}

export async function createReflection(input: CreateReflectionInput) {
  const org = getDefaultOrg();
  return prisma.platformMarcusReflection.create({
    data: {
      id:             createId(),
      orgId:          org.id,
      sessionId:      input.sessionId,
      subjectKind:    input.subjectKind ?? 'build_session',
      turnIndex:      input.turnIndex,
      triggerType:    input.triggerType,
      technique:      input.technique,
      headline:       input.headline,
      body:           input.body,
      suggestedAction: input.suggestedAction ?? undefined,
      severity:       input.severity,
      status:         input.status,
      stateSnapshot:  (input.stateSnapshot as any) ?? undefined,
      promptVersion:  input.promptVersion,
    },
  });
}

export async function getPendingReflections(sessionId: string) {
  const org = getDefaultOrg();
  return prisma.platformMarcusReflection.findMany({
    where: { orgId: org.id, sessionId, status: 'surfaced', deliveredAt: null },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getSessionReflections(sessionId: string) {
  const org = getDefaultOrg();
  return prisma.platformMarcusReflection.findMany({
    where: { orgId: org.id, sessionId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function markDelivered(reflectionId: string) {
  return prisma.platformMarcusReflection.update({
    where: { id: reflectionId },
    data:  { deliveredAt: new Date() },
  });
}

export async function resolveReflection(
  reflectionId: string,
  status: 'dismissed' | 'acknowledged' | 'acted',
) {
  return prisma.platformMarcusReflection.update({
    where: { id: reflectionId },
    data:  { status, resolvedAt: new Date() },
  });
}

export async function getThrottleState(sessionId: string) {
  const org = getDefaultOrg();
  const [surfacedCount, recentReflections] = await Promise.all([
    prisma.platformMarcusReflection.count({
      where: {
        orgId:       org.id,
        sessionId,
        status:      { in: ['surfaced','dismissed','acknowledged','acted'] },
        triggerType: { not: 'T7' },
      },
    }),
    prisma.platformMarcusReflection.findMany({
      where:   { orgId: org.id, sessionId },
      orderBy: { createdAt: 'desc' },
      take:    10,
      select:  { triggerType: true, technique: true, status: true, turnIndex: true, createdAt: true },
    }),
  ]);
  return { surfacedCount, recentReflections };
}
