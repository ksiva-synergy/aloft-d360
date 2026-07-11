import { getThrottleState } from './dal';
import type { TriggerType } from './types';

const MAX_SURFACED_PER_SESSION  = 3;  // excludes T7
const MIN_TURNS_BETWEEN_SURFACES = 4;
const T2_COOLDOWN_TURNS          = 3;

interface ThrottleInput {
  sessionId:       string;
  currentTurnIndex: number;
  proposedTrigger: TriggerType;
}

export interface ThrottleResult {
  allowed: boolean;
  reason?: string;
}

export async function checkThrottle(input: ThrottleInput): Promise<ThrottleResult> {
  const { surfacedCount, recentReflections } = await getThrottleState(input.sessionId);

  if (surfacedCount >= MAX_SURFACED_PER_SESSION) {
    return { allowed: false, reason: `session_ceiling_${MAX_SURFACED_PER_SESSION}` };
  }

  const lastSurfaced = recentReflections.find(
    r => r.status !== 'withheld' && r.turnIndex != null
  );
  if (lastSurfaced?.turnIndex != null) {
    const gap = input.currentTurnIndex - lastSurfaced.turnIndex;
    if (gap < MIN_TURNS_BETWEEN_SURFACES) {
      return { allowed: false, reason: `turn_spacing_${gap}_of_${MIN_TURNS_BETWEEN_SURFACES}` };
    }
  }

  if (input.proposedTrigger === 'T2') {
    const lastT2 = recentReflections.find(
      r => r.triggerType === 'T2' && r.turnIndex != null
    );
    if (lastT2?.turnIndex != null) {
      const gap = input.currentTurnIndex - lastT2.turnIndex;
      if (gap < T2_COOLDOWN_TURNS) {
        return { allowed: false, reason: `t2_cooldown_${gap}_of_${T2_COOLDOWN_TURNS}` };
      }
    }
  }

  if (input.currentTurnIndex < 2) {
    return { allowed: false, reason: 'too_early' };
  }

  return { allowed: true };
}

export function shouldSkipEvaluation(input: {
  currentTurnIndex:              number;
  lastMessageIsReflectionResponse: boolean;
}): boolean {
  if (input.currentTurnIndex < 2) return true;
  if (input.lastMessageIsReflectionResponse) return true;
  return false;
}
