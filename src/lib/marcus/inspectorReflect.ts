import { createReflection } from './dal';
import type { ReflectionStatus, TriggerType, Technique, Severity } from './types';

const PROMPT_VERSION = 'inspector_reflect_v1';
const FEATURE_FLAG = 'MARCUS_REFLECT_ENABLED';

export interface EvaluateTrajectoryParams {
  sessionId: string;
  trajectoryAnalysis: string;
  toolCalls: { toolUseId: string; name: string; input: string | Record<string, unknown> }[];
  datasourceCaveats: string[];
  agentClassId?: string;
}

export async function evaluateTrajectoryReflection(params: EvaluateTrajectoryParams) {
  if (process.env[FEATURE_FLAG] !== 'true') return;

  const reflections: {
    trigger: TriggerType;
    technique: Technique;
    headline: string;
    body: string;
    severity: Severity;
  }[] = [];

  // Heuristic 1: Catalog caveats
  // Triggers when the trajectory hits a dataset with known caveats.
  if (params.datasourceCaveats && params.datasourceCaveats.length > 0) {
    reflections.push({
      trigger: 'T3',
      technique: 'necessity',
      headline: 'Data Source Caveats Detected',
      body: `The agent queried a data source with known caveats: ${params.datasourceCaveats.join(', ')}`,
      severity: 'note',
    });
  }

  // Heuristic 2: Control boundary / multi-statement or non-select
  // The inspector only allows SELECT, WITH, SHOW, DESCRIBE.
  const hasControlBoundaryIssue = params.toolCalls.some(tc => {
    if (tc.name === 'execute_tool') {
      const inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input);
      const lc = inputStr.toLowerCase();
      // Heuristic for DML/DDL or multi-statement
      if (lc.includes('update ') || lc.includes('delete ') || lc.includes('insert ') || lc.includes('drop ') || lc.includes('truncate ')) {
         return true;
      }
    }
    return false;
  }) || params.trajectoryAnalysis.includes('MULTI_STATEMENT') || params.trajectoryAnalysis.includes('READ_ONLY_VIOLATION');

  if (hasControlBoundaryIssue) {
    reflections.push({
      trigger: 'T6',
      technique: 'premeditatio',
      headline: 'Control Boundary Violation',
      body: 'The agent attempted to execute a query that may violate read-only boundaries (e.g., DML/DDL operations).',
      severity: 'caution',
    });
  }

  if (process.env.MARCUS_FIRST_TURN_ALWAYS === 'true') {
    // Always surface at least one reflection on Inspector trajectories
    // Use existing heuristic triggers — if none fire, force a T5 note
    if (reflections.length === 0) {
      reflections.push({
        trigger: 'T5',
        technique: 'dichotomy_epictetus',
        headline: 'Every trajectory depends on inputs the agent cannot control.',
        body: 'Review the tool calls in this run against what was assumed to be stable. The agent controlled its queries — it did not control data freshness, API availability, or upstream schema changes.',
        severity: 'note',
      });
    }
  }

  for (const ref of reflections) {
    await createReflection({
      sessionId: params.sessionId,
      subjectKind: 'trajectory',
      triggerType: ref.trigger,
      technique: ref.technique,
      headline: ref.headline,
      body: ref.body,
      severity: ref.severity,
      status: 'surfaced',
      promptVersion: PROMPT_VERSION,
    });
  }
}
