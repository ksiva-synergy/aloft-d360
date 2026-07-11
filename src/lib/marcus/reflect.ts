import { createReflection } from './dal';
import { checkThrottle, shouldSkipEvaluation } from './throttle';
import { ReflectionEvalResultSchema } from './types';
import type { ReflectionStatus } from './types';
import { REFLECT_V1_PROMPT, FIRST_TURN_V1_PROMPT, INSPECTOR_FIRST_TURN_PROMPT } from './prompts';

const PROMPT_VERSION = 'reflect_v1';
const FEATURE_FLAG   = 'MARCUS_REFLECT_ENABLED';

export interface ReflectInput {
  sessionId:                      string;
  turnIndex:                      number;
  constructionState:              Record<string, unknown>;
  stateDelta:                     Record<string, unknown>;
  assumptionLedger:               Array<Record<string, unknown>>;
  transcriptTail:                 Array<{ role: string; content: string }>;
  priorReflections:               Array<{ triggerType: string; technique: string; status: string }>;
  classGates?:                    string[];
  datasourceCaveats?:             string[];
  lastMessageIsReflectionResponse?: boolean;
}

/**
 * Fire-and-forget. Call AFTER the main SSE stream closes.
 * Never throws — all errors are swallowed and logged.
 */
export async function evaluateForReflection(input: ReflectInput): Promise<void> {
  try {
    if (process.env[FEATURE_FLAG] !== 'true') return;

    // First-turn forced surface
    if (process.env.MARCUS_FIRST_TURN_ALWAYS === 'true' && input.turnIndex === 1) {
      await evaluateFirstTurn(input);
      return;
    }

    if (shouldSkipEvaluation({
      currentTurnIndex:               input.turnIndex,
      lastMessageIsReflectionResponse: input.lastMessageIsReflectionResponse ?? false,
    })) return;

    const template = REFLECT_V1_PROMPT;

    const userContent = JSON.stringify({
      CONSTRUCTION_STATE:  input.constructionState,
      STATE_DELTA:         input.stateDelta,
      ASSUMPTION_LEDGER:   input.assumptionLedger,
      TRANSCRIPT_TAIL:     input.transcriptTail.slice(-6),
      PRIOR_REFLECTIONS:   input.priorReflections,
      CLASS_GATES:         input.classGates        ?? [],
      DATASOURCE_CAVEATS:  input.datasourceCaveats ?? [],
    });

    // Bedrock call via existing client pattern
    const {
      BedrockRuntimeClient,
      ConverseCommand,
    } = await import('@aws-sdk/client-bedrock-runtime');

    const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1' });

    const res = await client.send(new ConverseCommand({
      modelId:  process.env.BEDROCK_SONNET_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6',
      system:   [{ text: template }],
      messages: [{ role: 'user', content: [{ text: userContent }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0.3 },
    }));

    const rawText: string = res.output?.message?.content?.[0]?.text ?? '{"surface":false}';

    let evalResult;
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      evalResult = ReflectionEvalResultSchema.parse(JSON.parse(cleaned));
    } catch {
      console.warn('[marcus/reflect] parse failed:', rawText.slice(0, 200));
      return;
    }

    if (!evalResult.surface) return;

    const throttle = await checkThrottle({
      sessionId:        input.sessionId,
      currentTurnIndex: input.turnIndex,
      proposedTrigger:  evalResult.trigger!,
    });

    const status: ReflectionStatus = throttle.allowed ? 'surfaced' : 'withheld';

    await createReflection({
      sessionId:       input.sessionId,
      subjectKind:     'build_session',
      turnIndex:       input.turnIndex,
      triggerType:     evalResult.trigger!,
      technique:       evalResult.technique!,
      headline:        evalResult.headline!,
      body:            evalResult.body!,
      suggestedAction: evalResult.suggested_action ?? null,
      severity:        evalResult.severity!,
      status,
      stateSnapshot:   input.constructionState,
      promptVersion:   PROMPT_VERSION,
    });

    if (!throttle.allowed) {
      console.log(`[marcus/reflect] withheld: ${throttle.reason} trigger=${evalResult.trigger} session=${input.sessionId}`);
    } else {
      console.log(`[marcus/reflect] surfaced: trigger=${evalResult.trigger} technique=${evalResult.technique} session=${input.sessionId}`);
    }

  } catch (err) {
    console.error('[marcus/reflect] evaluation failed (silently):', err);
  }
}

async function evaluateFirstTurn(input: ReflectInput): Promise<void> {
  try {
    const template = FIRST_TURN_V1_PROMPT;

    const {
      BedrockRuntimeClient,
      ConverseCommand,
    } = await import('@aws-sdk/client-bedrock-runtime');

    const client = new BedrockRuntimeClient({ 
      region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
    });

    // Use the last user message as the mission statement.
    // transcriptTail content may be a plain string or a JSON-serialised ContentBlock[].
    const rawContent = input.transcriptTail
      .filter(m => m.role === 'user')
      .at(-1)?.content ?? '';
    let missionStatement = rawContent;
    if (rawContent.startsWith('[')) {
      try {
        const blocks = JSON.parse(rawContent) as Array<{ text?: string }>;
        missionStatement = blocks.map(b => b.text ?? '').join(' ').trim();
      } catch { /* keep rawContent */ }
    }

    const res = await client.send(new ConverseCommand({
      modelId:  process.env.BEDROCK_SONNET_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6',
      system:   [{ text: template }],
      messages: [{ role: 'user', content: [{ text: missionStatement }] }],
      inferenceConfig: { maxTokens: 600, temperature: 0.3 },
    }));

    const rawText: string = res.output?.message?.content?.[0]?.text ?? '{"surface":false}';

    const cleaned = rawText.replace(/```json|```/g, '').trim();
    let evalResult;
    try {
      evalResult = ReflectionEvalResultSchema.parse(JSON.parse(cleaned));
    } catch {
      console.warn('[marcus/reflect] first-turn parse failed:', rawText.slice(0, 200));
      return;
    }

    if (!evalResult.surface) return;

    await createReflection({
      sessionId:       input.sessionId,
      subjectKind:     'build_session',
      turnIndex:       1,
      triggerType:     evalResult.trigger!,
      technique:       evalResult.technique!,
      headline:        evalResult.headline!,
      body:            evalResult.body!,
      suggestedAction: evalResult.suggested_action ?? null,
      severity:        evalResult.severity ?? 'note',
      status:          'surfaced',
      stateSnapshot:   input.constructionState,
      promptVersion:   'first_turn_v1',
    });

    console.log(`[marcus/reflect] first-turn surfaced: technique=${evalResult.technique} session=${input.sessionId}`);
  } catch (err) {
    console.error('[marcus/reflect] first-turn evaluation failed (silently):', err);
  }
}

/**
 * Inspector first-turn reflection — fires on the analyst's very first question.
 * Uses INSPECTOR_FIRST_TURN_PROMPT (data-exploration framing, not agent-build framing).
 * Call fire-and-forget from the inspector chat route after the stream closes.
 */
export async function evaluateInspectorFirstTurn(params: {
  sessionId: string;
  firstQuestion: string;
}): Promise<void> {
  if (process.env[FEATURE_FLAG] !== 'true') return;
  if (process.env.MARCUS_FIRST_TURN_ALWAYS !== 'true') return;

  try {
    const {
      BedrockRuntimeClient,
      ConverseCommand,
    } = await import('@aws-sdk/client-bedrock-runtime');

    const client = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
    });

    const res = await client.send(new ConverseCommand({
      modelId:  process.env.BEDROCK_SONNET_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6',
      system:   [{ text: INSPECTOR_FIRST_TURN_PROMPT }],
      messages: [{ role: 'user', content: [{ text: params.firstQuestion }] }],
      inferenceConfig: { maxTokens: 600, temperature: 0.3 },
    }));

    const rawText: string = res.output?.message?.content?.[0]?.text ?? '{"surface":false}';

    const cleaned = rawText.replace(/```json|```/g, '').trim();
    let evalResult;
    try {
      evalResult = ReflectionEvalResultSchema.parse(JSON.parse(cleaned));
    } catch {
      console.warn('[marcus/reflect] inspector first-turn parse failed:', rawText.slice(0, 200));
      return;
    }

    if (!evalResult.surface) return;

    await createReflection({
      sessionId:       params.sessionId,
      subjectKind:     'trajectory',
      turnIndex:       1,
      triggerType:     evalResult.trigger!,
      technique:       evalResult.technique!,
      headline:        evalResult.headline!,
      body:            evalResult.body!,
      suggestedAction: evalResult.suggested_action ?? null,
      severity:        evalResult.severity ?? 'note',
      status:          'surfaced',
      stateSnapshot:   {},
      promptVersion:   'inspector_first_turn_v1',
    });

    console.log(`[marcus/reflect] inspector first-turn surfaced: technique=${evalResult.technique} session=${params.sessionId}`);
  } catch (err) {
    console.error('[marcus/reflect] inspector first-turn evaluation failed (silently):', err);
  }
}
