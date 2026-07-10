// INVARIANT: no warehouse access in this file.
// All reads come exclusively from platform_context_* tables via Prisma.
// executeDatabricksSQL must never be called here, directly or transitively.

import 'server-only';
import { z } from 'zod';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import { finalize } from './queue';

// ── Models & constants ────────────────────────────────────────────────────────

const ADJUDICATE_MODEL = 'us.anthropic.claude-sonnet-4-6';

const ADJUDICATION_SYSTEM = `You are a data catalog mapping engine for a maritime crew-management platform.
Your job is to adjudicate candidate object links across databases/schemas and decide whether they represent a data silo, duplicate tables, related tables, or completely unrelated tables.

Return a single valid JSON array — one element per input pair, in the same order as the input.
No markdown fences. No preamble. No trailing explanation.
The first character of your response must be [ and the last must be ].

Each array element has EXACTLY this structure:
{
  "pair_index": <integer matching the input pair_index>,
  "verdict": "silo" | "duplicate" | "related" | "unrelated",
  "reasoning": "<one sentence: why this verdict, citing the strongest signals, max 200 characters>",
  "confidence": <number 0.0–1.0>
}

verdict meanings:
- silo: Same business entity/domain concept, located in different schemas or catalogs, indicating potential data silo.
- duplicate: Identical or near-identical copies of the same table (e.g. scratch, temp, or backup copies).
- related: Distinct business entities, but semantically related or connected (e.g. parent-child, foreign keys).
- unrelated: No meaningful business relationship.`;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ObjectLinkVerdictSchema = z.object({
  pair_index: z.number().int().nonnegative(),
  verdict: z.enum(['silo', 'duplicate', 'related', 'unrelated']),
  reasoning: z.string().max(200),
  confidence: z.number().min(0).max(1),
});

const AdjudicationBatchSchema = z.array(ObjectLinkVerdictSchema);
type ObjectLinkVerdict = z.infer<typeof ObjectLinkVerdictSchema>;

// ── Bedrock client helper ──────────────────────────────────────────────────────

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

// ── Helpers for extracting labels and metadata ───────────────────────────────

function getLabelsFromEntityTags(entityTags: unknown): Set<string> {
  const labels = new Set<string>();
  if (entityTags && typeof entityTags === 'object') {
    const tags = entityTags as { groups?: Array<{ label: string }> };
    for (const grp of tags.groups ?? []) {
      if (grp.label) labels.add(grp.label);
    }
  }
  return labels;
}

// ── Core runSiloScan orchestrator ──────────────────────────────────────────────

export interface SiloScanOptions {
  topN?: number;
  minScore?: number;
  includeRejected?: boolean;
  jobId?: string;
}

export interface SiloScanResult {
  jobId?: string;
  scannedCount: number;
  candidatesFound: number;
  status: 'succeeded' | 'failed';
  error?: string;
}

export async function runSiloScan(
  objectId: string,
  orgId: string,
  opts?: SiloScanOptions,
): Promise<SiloScanResult> {
  const topN = opts?.topN ?? 15;
  const minScore = opts?.minScore ?? 0.60;
  const includeRejected = opts?.includeRejected === true;
  const jobId = opts?.jobId;

  const tStart = Date.now();

  const updateStage = async (stage: string, extraStats: Record<string, any> = {}) => {
    if (!jobId) return;
    await prisma.platformContextJob.update({
      where: { id: jobId },
      data: {
        stats: {
          stage,
          stage_start: new Date().toISOString(),
          ...extraStats,
        },
      },
    });
  };

  try {
    // ── ① Object embedding cosine via HNSW ─────────────────────────────────────
    await updateStage('embedding_search');

    const sourceEmbedRows = await prisma.$queryRaw<Array<{ embedding: string | null }>>`
      SELECT embedding::text FROM platform_context_embeddings
      WHERE org_id = ${orgId}
        AND subject_kind = 'object'
        AND subject_id = ${objectId}::uuid
    `;

    if (sourceEmbedRows.length === 0 || !sourceEmbedRows[0].embedding) {
      throw new Error(`Embedding not found for object ID: ${objectId}`);
    }

    const sourceVecStr = sourceEmbedRows[0].embedding;

    const embedRows = await prisma.$queryRaw<Array<{ subject_id: string; similarity: number }>>`
      SELECT
        e.subject_id::text AS subject_id,
        (1 - (e.embedding <=> ${sourceVecStr}::text::vector))::float AS similarity
      FROM platform_context_embeddings e
      WHERE e.org_id = ${orgId}
        AND e.subject_kind = 'object'
        AND e.subject_id <> ${objectId}::uuid
        AND e.embedding IS NOT NULL
      ORDER BY e.embedding <=> ${sourceVecStr}::text::vector ASC
      LIMIT 50
    `;

    let candidates = embedRows.map(r => ({
      candidateId: r.subject_id,
      embedCosine: Math.max(0, r.similarity),
    }));

    if (!includeRejected) {
      const rejectedLinks = await prisma.platformContextObjectLink.findMany({
        where: {
          org_id: orgId,
          status: 'rejected',
          OR: [
            { left_object_id: objectId },
            { right_object_id: objectId },
          ],
        },
        select: { left_object_id: true, right_object_id: true },
      });
      const rejectedSet = new Set<string>();
      for (const link of rejectedLinks) {
        rejectedSet.add(link.left_object_id === objectId ? link.right_object_id : link.left_object_id);
      }
      candidates = candidates.filter(c => !rejectedSet.has(c.candidateId));
    }

    const tEmbed = Date.now();
    const embedDuration = tEmbed - tStart;

    // ── ② Per-candidate signal pack (Aurora only) ──────────────────────────────
    await updateStage('signal_computation', {
      embedding_search_duration_ms: embedDuration,
    });

    const sourceCols = await prisma.platformContextColumn.findMany({
      where: { org_id: orgId, object_id: objectId, lifecycle: 'active' },
      select: { name: true, data_type: true, profile: true },
    });
    const sourceColNames = new Set(sourceCols.map(c => c.name));
    const sourceColMap = new Map(sourceCols.map(c => [c.name, c]));

    const candidateIds = candidates.map(c => c.candidateId);
    const allCandidateCols = await prisma.platformContextColumn.findMany({
      where: { org_id: orgId, object_id: { in: candidateIds }, lifecycle: 'active' },
      select: { object_id: true, name: true, data_type: true, profile: true },
    });

    const colsByObjectId = new Map<string, typeof allCandidateCols>();
    for (const col of allCandidateCols) {
      if (!colsByObjectId.has(col.object_id)) {
        colsByObjectId.set(col.object_id, []);
      }
      colsByObjectId.get(col.object_id)!.push(col);
    }

    const objects = await prisma.platformContextObject.findMany({
      where: { org_id: orgId, id: { in: [objectId, ...candidateIds] } },
      select: { id: true, entity_tags: true },
    });
    const entityTagsMap = new Map<string, unknown>(objects.map(o => [o.id, o.entity_tags]));
    const sourceLabels = getLabelsFromEntityTags(entityTagsMap.get(objectId));

    const scoredCandidates: Array<{
      candidateId: string;
      embedCosine: number;
      columnNameOverlap: number;
      typeCompatRatio: number;
      profileShapeSim: number | null;
      sharedEntityTags: number;
      compositeScore: number;
    }> = [];

    for (const cand of candidates) {
      const candidateId = cand.candidateId;
      const candidateCols = colsByObjectId.get(candidateId) ?? [];
      const candidateColNames = new Set(candidateCols.map(c => c.name));
      const candidateColMap = new Map(candidateCols.map(c => [c.name, c]));

      // 1. column_name_overlap
      let overlapCount = 0;
      for (const name of sourceColNames) {
        if (candidateColNames.has(name)) {
          overlapCount++;
        }
      }
      const columnNameOverlap = overlapCount / Math.max(sourceColNames.size, candidateColNames.size || 1);

      // 2. type_compat_ratio
      let typeMatchCount = 0;
      let overlapColsCount = 0;
      for (const name of sourceColNames) {
        if (candidateColNames.has(name)) {
          overlapColsCount++;
          const sourceCol = sourceColMap.get(name)!;
          const candidateCol = candidateColMap.get(name)!;
          if (sourceCol.data_type && candidateCol.data_type && sourceCol.data_type === candidateCol.data_type) {
            typeMatchCount++;
          }
        }
      }
      const typeCompatRatio = overlapColsCount > 0 ? typeMatchCount / overlapColsCount : 0.0;

      // 3. profile_shape_sim
      let profileShapeSim: number | null = null;
      let totalDiff = 0;
      let countWithNullRates = 0;
      for (const name of sourceColNames) {
        if (candidateColNames.has(name)) {
          const sourceCol = sourceColMap.get(name)!;
          const candidateCol = candidateColMap.get(name)!;
          const sourceProfile = sourceCol.profile as Record<string, unknown> | null;
          const candidateProfile = candidateCol.profile as Record<string, unknown> | null;
          if (
            sourceProfile && typeof sourceProfile.null_rate === 'number' &&
            candidateProfile && typeof candidateProfile.null_rate === 'number'
          ) {
            totalDiff += Math.abs(sourceProfile.null_rate - candidateProfile.null_rate);
            countWithNullRates++;
          }
        }
      }
      if (countWithNullRates > 0) {
        profileShapeSim = 1 - (totalDiff / countWithNullRates);
      }

      // 4. shared_entity_tags
      const candidateLabels = getLabelsFromEntityTags(entityTagsMap.get(candidateId));
      let sharedEntityTags = 0;
      for (const label of sourceLabels) {
        if (candidateLabels.has(label)) {
          sharedEntityTags++;
        }
      }

      const compositeScore =
        0.40 * cand.embedCosine +
        0.25 * columnNameOverlap +
        0.15 * typeCompatRatio +
        0.10 * (profileShapeSim ?? 0) +
        0.10 * Math.min(sharedEntityTags / 3, 1.0);

      if (compositeScore >= minScore) {
        scoredCandidates.push({
          candidateId,
          embedCosine: cand.embedCosine,
          columnNameOverlap,
          typeCompatRatio,
          profileShapeSim,
          sharedEntityTags,
          compositeScore,
        });
      }
    }

    scoredCandidates.sort((a, b) => b.compositeScore - a.compositeScore);
    const finalCandidates = scoredCandidates.slice(0, topN);

    const tSignals = Date.now();
    const signalsDuration = tSignals - tEmbed;

    // ── ③ Batched LLM adjudication for top N (default 10) ──────────────────────
    await updateStage('llm_adjudication', {
      embedding_search_duration_ms: embedDuration,
      signal_computation_duration_ms: signalsDuration,
    });

    const llmTargets = finalCandidates.slice(0, 10);
    const llmVerdicts = new Map<string, ObjectLinkVerdict>();

    let totalInput = 0;
    let totalOutput = 0;

    if (llmTargets.length > 0) {
      const allSemanticsIds = [objectId, ...llmTargets.map(c => c.candidateId)];
      const semantics = await prisma.platformContextSemantic.findMany({
        where: { subject_kind: 'object', subject_id: { in: allSemanticsIds } },
        orderBy: { version: 'desc' },
        select: { subject_id: true, card: true },
      });

      const semanticMap = new Map<string, any>();
      for (const sem of semantics) {
        if (!semanticMap.has(sem.subject_id)) {
          semanticMap.set(sem.subject_id, sem.card);
        }
      }

      const pairsForLlm = llmTargets.map((cand, idx) => ({
        pair_index: idx,
        left: semanticMap.get(objectId) ?? {},
        right: semanticMap.get(cand.candidateId) ?? {},
        signals: {
          embedCosine: cand.embedCosine,
          columnNameOverlap: cand.columnNameOverlap,
          typeCompatRatio: cand.typeCompatRatio,
          profileShapeSim: cand.profileShapeSim,
          sharedEntityTags: cand.sharedEntityTags,
          compositeScore: cand.compositeScore,
        },
      }));

      const pairsJson = JSON.stringify(pairsForLlm, null, 2);

      const userMessage =
        `Adjudicate the following object link candidates and return a JSON array of verdicts.\n\n` +
        `## Context\n\nPlatform: maritime crew management (Synergy Group). All tables are in the same Databricks data estate.\n` +
        `Candidate pairs were generated by the ALOFT Mendeleev context harness Stage 1 silo signal engine.\n\n` +
        `## Pairs (${pairsForLlm.length} total)\n\n${pairsJson}\n\n` +
        `## Output\n\nReturn a JSON array of exactly ${pairsForLlm.length} elements, one per pair in the same order.\n` +
        `Each element: { pair_index, verdict, reasoning, confidence }\n` +
        `First character must be [. No markdown. No preamble.`;

      type Msg = { role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] };
      const messages: Msg[] = [{ role: 'user', content: [{ type: 'text', text: userMessage }] }];

      const client = getBedrockClient();

      const invoke = async (msgs: Msg[]) => {
        const cmd = new ConverseCommand({
          modelId: ADJUDICATE_MODEL,
          system: [{ text: ADJUDICATION_SYSTEM }],
          messages: msgs,
          inferenceConfig: { temperature: 0.2, maxTokens: 8192 },
        });
        const resp = await client.send(cmd);
        const text =
          resp.output?.message?.content
            ?.map((b) => ('text' in b ? (b as { text: string }).text : ''))
            .join('') ?? '';
        return {
          text,
          input: resp.usage?.inputTokens ?? 0,
          output: resp.usage?.outputTokens ?? 0,
        };
      };

      const tryParseAndValidate = (text: string): ObjectLinkVerdict[] | null => {
        let s = text.trim();
        if (s.startsWith('```')) {
          s = s.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
        }
        try {
          const parsed = JSON.parse(s);
          const result = AdjudicationBatchSchema.safeParse(parsed);
          return result.success ? result.data : null;
        } catch {
          return null;
        }
      };

      let llmCallResult;
      try {
        llmCallResult = await invoke(messages);
      } catch (err) {
        console.warn('[silo] Bedrock call failed', err);
      }

      if (llmCallResult) {
        totalInput += llmCallResult.input;
        totalOutput += llmCallResult.output;
        let parsed = tryParseAndValidate(llmCallResult.text);

        if (!parsed) {
          // Retry once
          const retryMsgs: Msg[] = [
            ...messages,
            { role: 'assistant', content: [{ type: 'text', text: llmCallResult.text }] },
            {
              role: 'user',
              content: [{ type: 'text', text: 'Your previous response was not valid JSON array. Return ONLY the array starting with [. No other text.' }],
            },
          ];
          try {
            const retryResult = await invoke(retryMsgs);
            totalInput += retryResult.input;
            totalOutput += retryResult.output;
            parsed = tryParseAndValidate(retryResult.text);
          } catch (err) {
            console.warn('[silo] Bedrock retry failed', err);
          }
        }

        if (parsed) {
          for (const item of parsed) {
            const cand = llmTargets[item.pair_index];
            if (cand) {
              llmVerdicts.set(cand.candidateId, item);
            }
          }
        }
      }
    }

    const tLLM = Date.now();
    const llmDuration = tLLM - tSignals;

    // ── ④ Persist to platform_context_object_links ─────────────────────────────
    await updateStage('persist', {
      embedding_search_duration_ms: embedDuration,
      signal_computation_duration_ms: signalsDuration,
      llm_adjudication_duration_ms: llmDuration,
    });

    for (const cand of finalCandidates) {
      const [leftId, rightId] = objectId < cand.candidateId ? [objectId, cand.candidateId] : [cand.candidateId, objectId];
      const signalsJson = {
        embedCosine: cand.embedCosine,
        columnNameOverlap: cand.columnNameOverlap,
        typeCompatRatio: cand.typeCompatRatio,
        profileShapeSim: cand.profileShapeSim,
        sharedEntityTags: cand.sharedEntityTags,
        compositeScore: cand.compositeScore,
      };

      const verdictObj = llmVerdicts.get(cand.candidateId);
      const llmVerdictJson = verdictObj ? {
        verdict: verdictObj.verdict,
        reasoning: verdictObj.reasoning,
        confidence: verdictObj.confidence,
      } : null;

      const existingLink = await prisma.platformContextObjectLink.findUnique({
        where: {
          org_id_left_object_id_right_object_id_link_kind: {
            org_id: orgId,
            left_object_id: leftId,
            right_object_id: rightId,
            link_kind: 'silo_candidate',
          },
        },
      });

      if (existingLink) {
        if (existingLink.status === 'proposed') {
          await prisma.platformContextObjectLink.update({
            where: { id: existingLink.id },
            data: {
              score: cand.compositeScore,
              signals: signalsJson,
              llm_verdict: llmVerdictJson === null ? Prisma.DbNull : (llmVerdictJson as Prisma.InputJsonValue),
              job_id: jobId,
            },
          });
        }
      } else {
        await prisma.platformContextObjectLink.create({
          data: {
            id: uuidv4(),
            org_id: orgId,
            left_object_id: leftId,
            right_object_id: rightId,
            link_kind: 'silo_candidate',
            score: cand.compositeScore,
            signals: signalsJson,
            llm_verdict: llmVerdictJson === null ? Prisma.DbNull : (llmVerdictJson as Prisma.InputJsonValue),
            status: 'proposed',
            job_id: jobId,
          },
        });
      }
    }

    const tPersist = Date.now();
    const persistDuration = tPersist - tLLM;

    const finalStats = {
      embedding_search_duration_ms: embedDuration,
      signal_computation_duration_ms: signalsDuration,
      llm_adjudication_duration_ms: llmDuration,
      persist_duration_ms: persistDuration,
      scanned_count: candidates.length,
      candidates_found: finalCandidates.length,
      llm_tokens: {
        input: totalInput,
        output: totalOutput,
      },
    };

    if (jobId) {
      await finalize(jobId, 'succeeded', finalStats);
    }

    return {
      jobId,
      scannedCount: candidates.length,
      candidatesFound: finalCandidates.length,
      status: 'succeeded',
    };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) {
      await finalize(jobId, 'failed', {}, msg);
    }
    return {
      jobId,
      scannedCount: 0,
      candidatesFound: 0,
      status: 'failed',
      error: msg,
    };
  }
}
