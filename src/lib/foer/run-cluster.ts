/**
 * run-cluster.ts — LLM-first topic classification for FOER-T.
 *
 * Strategy: instead of k-means + post-hoc naming, we send all distinct
 * taskSignatures (with their shortLabel + sample rule texts) to Bedrock
 * Sonnet and ask it to classify each into a fixed domain vocabulary.
 * This guarantees 100% assignment (no outlier exclusion) and produces
 * semantically coherent groups because the LLM reads the actual rule texts.
 *
 * Coverage thresholds:
 *   COVERAGE_TARGET  = 0.90  — ≥90% triggers pullForwardTriggered flag
 *   COVERAGE_MIN_BAR = 0.75  — <75% emits a belowMinBar warning
 */

import { createId } from '@paralleldrive/cuid2';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { prisma } from '@/lib/prisma';
import { currentPeriod } from '@/lib/foer/topics';

// ── Constants ─────────────────────────────────────────────────────────────────

const SONNET_MODEL    = 'us.anthropic.claude-sonnet-4-6';
const SONNET_REGION   = 'us-east-1';
const PROMPT_VERSION  = 'llm_classify_v1';
const BATCH_SIZE      = 20; // signatures per Bedrock call

export const COVERAGE_TARGET  = 0.90;
export const COVERAGE_MIN_BAR = 0.75;

// ── Coverage trigger ──────────────────────────────────────────────────────────

/**
 * Returns true when topic coverage has dropped below the target threshold and
 * reclassification should run. Pure — no I/O, trivially unit-testable.
 */
export function shouldReclassify({
  coveragePercent,
  target,
}: {
  coveragePercent: number;
  target: number;
}): boolean {
  return coveragePercent < target;
}

// ── Fixed domain vocabulary ───────────────────────────────────────────────────

export interface DomainEntry {
  key:  string;
  name: string;
  desc: string;
}

export const DOMAIN_VOCABULARY: DomainEntry[] = [
  {
    key:  'estate_navigation',
    name: 'Estate Navigation',
    desc: 'catalog/schema browsing, table/column discovery, data lineage, Fivetran metadata, system columns, database exploration',
  },
  {
    key:  'crew_personnel',
    name: 'Crew & Personnel',
    desc: 'crew contracts, seafarer records, active_contract, headcount, certifications, crew assignments, personnel data',
  },
  {
    key:  'vessel_voyage',
    name: 'Vessel & Voyage',
    desc: 'vessel particulars, voyage records, port calls, port classification, IMO data, vessel status, departure/arrival',
  },
  {
    key:  'financial_accounts',
    name: 'Financial Accounts',
    desc: 'cost accounting, wage accounts, billing, financial line items, ledger entries, payroll, expense tracking',
  },
  {
    key:  'port_logistics',
    name: 'Port & Logistics',
    desc: 'port logistics, departure logs, operational scheduling, cargo, noon reports, port agent data',
  },
  {
    key:  'platform_config',
    name: 'Platform Configuration',
    desc: 'agent settings, connection setup, analytics configuration, testing, system verification, environment checks',
  },
];

// ── Public result type ────────────────────────────────────────────────────────

export interface ClusterRunResult {
  ok:                    boolean;
  period:                string;
  clustersCreated:       number;
  signaturesAssigned:    number;
  signaturesTotal:       number;
  coveragePercent:       number;
  pullForwardTriggered:  boolean;
  belowMinBar:           boolean;
  warning:               string | null;
  error:                 string | null;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface SigInput {
  sig:        string;
  shortLabel: string | null;
  ruleSamples: string[];
}

interface ClassifyOutput {
  sig:    string;
  domain: string;
}

// ── Bedrock client ────────────────────────────────────────────────────────────

function getSonnetClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region: SONNET_REGION });
}

// ── LLM classification (single batch) ────────────────────────────────────────

async function classifyBatch(
  client: BedrockRuntimeClient,
  batch: SigInput[],
): Promise<ClassifyOutput[]> {
  const domainList = DOMAIN_VOCABULARY.map(
    (d) => `  • "${d.key}" — ${d.name}: ${d.desc}`,
  ).join('\n');

  const payload = batch.map((s) => ({
    sig:          s.sig,
    short_label:  s.shortLabel ?? s.sig,
    rule_samples: s.ruleSamples,
  }));

  const cmd = new ConverseCommand({
    modelId: SONNET_MODEL,
    system: [
      {
        text: `You are ALOFT's maritime data domain classifier.

You will receive a JSON array of agent memory signatures. Each has:
- "sig": a short hash identifier
- "short_label": a human-readable hint (may be noisy — use rule_samples as ground truth)
- "rule_samples": up to 8 actual rules the agent learned for this signature

Your job: assign each signature to EXACTLY ONE of these domains:

${domainList}
  • "other" — if no domain above fits

RULES:
- Base your decision on the content of rule_samples, not short_label
- When in doubt, prefer "estate_navigation" for any catalog/schema/column work
- Every sig in the input MUST appear in the output — no omissions
- Return ONLY a JSON array: [{"sig":"...","domain":"domain_key"},...]
- Do not explain or add prose`,
      },
    ],
    messages: [
      {
        role: 'user',
        content: [{ text: JSON.stringify(payload, null, 2) }],
      },
    ],
    inferenceConfig: { maxTokens: 1024, temperature: 0.0 },
  });

  const resp = await client.send(cmd);
  const text =
    resp.output?.message?.content
      ?.filter((b) => b.text)
      .map((b) => b.text!)
      .join('') ?? '';

  try {
    return JSON.parse(text) as ClassifyOutput[];
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`Bedrock returned non-JSON: ${text.slice(0, 300)}`);
    return JSON.parse(match[0]) as ClassifyOutput[];
  }
}

// ── Validate domain key ───────────────────────────────────────────────────────

function resolveDomain(rawKey: string): DomainEntry {
  const found = DOMAIN_VOCABULARY.find((d) => d.key === rawKey);
  if (found) return found;
  // "other" or unknown → estate_navigation as safe default
  return DOMAIN_VOCABULARY[0];
}

// ── Mock classifier (offline / testing) ──────────────────────────────────────

function mockClassify(sigs: SigInput[]): ClassifyOutput[] {
  return sigs.map((s) => {
    const label = (s.shortLabel ?? '').toLowerCase();
    if (label.includes('crew') || label.includes('contract') || label.includes('personnel')) {
      return { sig: s.sig, domain: 'crew_personnel' };
    }
    if (label.includes('vessel') || label.includes('voyage') || label.includes('port') || label.includes('imo')) {
      return { sig: s.sig, domain: 'vessel_voyage' };
    }
    if (label.includes('financial') || label.includes('wage') || label.includes('cost') || label.includes('billing')) {
      return { sig: s.sig, domain: 'financial_accounts' };
    }
    return { sig: s.sig, domain: 'estate_navigation' };
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export interface RunClusterOptions {
  orgId:     string;
  period?:   string;
  mockNames?: boolean;
}

export async function runCluster(opts: RunClusterOptions): Promise<ClusterRunResult> {
  const { orgId, mockNames = false } = opts;
  const period = opts.period ?? currentPeriod();

  const makeResult = (partial: Partial<ClusterRunResult>): ClusterRunResult => ({
    ok:                   false,
    period,
    clustersCreated:      0,
    signaturesAssigned:   0,
    signaturesTotal:      0,
    coveragePercent:      0,
    pullForwardTriggered: false,
    belowMinBar:          false,
    warning:              null,
    error:                null,
    ...partial,
  });

  // 1. Fetch all ACTIVE memory rows (rule texts + short_label)
  let rows: {
    task_signature: string;
    rule_text:      string;
    confidence:     number;
    short_label:    string | null;
  }[];

  try {
    rows = await prisma.$queryRawUnsafe<typeof rows>(
      `SELECT task_signature,
              rule_text,
              confidence,
              short_label
       FROM   platform_agent_memory
       WHERE  org_id = $1
         AND  status = 'ACTIVE'
         AND  task_signature IS NOT NULL
       ORDER  BY confidence DESC`,
      orgId,
    );
  } catch (err) {
    return makeResult({ error: `DB query failed: ${String(err)}` });
  }

  if (rows.length === 0) {
    return makeResult({ ok: true, warning: 'No ACTIVE memory rows to classify.' });
  }

  // 2. Aggregate per signature — top 8 rule texts by confidence
  const sigMap = new Map<
    string,
    { ruleTexts: string[]; confidence: number[]; shortLabel: string | null }
  >();

  for (const row of rows) {
    const entry = sigMap.get(row.task_signature) ?? {
      ruleTexts:  [],
      confidence: [],
      shortLabel: row.short_label ?? null,
    };
    entry.ruleTexts.push(row.rule_text);
    entry.confidence.push(Number(row.confidence));
    // prefer the first non-null shortLabel we encounter
    if (!entry.shortLabel && row.short_label) entry.shortLabel = row.short_label;
    sigMap.set(row.task_signature, entry);
  }

  const signatures = [...sigMap.keys()];
  const signaturesTotal = signatures.length;

  if (signaturesTotal === 0) {
    return makeResult({ ok: true, signaturesTotal, warning: 'No signatures found.' });
  }

  // Build SigInput array with top 8 rule texts
  const inputs: SigInput[] = signatures.map((sig) => {
    const entry = sigMap.get(sig)!;
    const sorted = entry.ruleTexts
      .map((t, i) => ({ t, c: entry.confidence[i] }))
      .sort((a, b) => b.c - a.c)
      .slice(0, 8)
      .map((x) => x.t);
    return { sig, shortLabel: entry.shortLabel, ruleSamples: sorted };
  });

  // 3. Classify in batches
  let allResults: ClassifyOutput[] = [];

  if (mockNames) {
    allResults = mockClassify(inputs);
  } else {
    const client = getSonnetClient();
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const batch = inputs.slice(i, i + BATCH_SIZE);
      try {
        const batchResults = await classifyBatch(client, batch);
        allResults.push(...batchResults);
      } catch (err) {
        return makeResult({
          signaturesTotal,
          error: `Bedrock classification failed (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${String(err)}`,
        });
      }
    }
  }

  // 4. Build sig → domain map; any sig not returned by LLM gets estate_navigation
  const classifyMap = new Map<string, string>(allResults.map((r) => [r.sig, r.domain]));
  for (const sig of signatures) {
    if (!classifyMap.has(sig)) classifyMap.set(sig, 'estate_navigation');
  }

  // 5. Group by domain to compute member counts and ranks
  const domainSigs = new Map<string, string[]>();
  for (const [sig, domainKey] of classifyMap.entries()) {
    const resolved = resolveDomain(domainKey);
    if (!domainSigs.has(resolved.key)) domainSigs.set(resolved.key, []);
    domainSigs.get(resolved.key)!.push(sig);
  }

  // Rank by member count descending
  const domainsByRank = [...domainSigs.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key]) => key);
  const rankMap = new Map(domainsByRank.map((key, rank) => [key, rank]));

  // 6. Upsert: delete old rows for this period, insert fresh
  await prisma.platformMemoryTopic.deleteMany({ where: { orgId, period } });

  const insertData: {
    id: string; orgId: string; period: string; topicKey: string; topicName: string;
    topicRank: number; taskSignature: string; memberCount: number; promptVersion: string; createdAt: Date;
  }[] = [];

  for (const [sig, domainKey] of classifyMap.entries()) {
    const resolved    = resolveDomain(domainKey);
    const memberCount = domainSigs.get(resolved.key)?.length ?? 1;
    const topicRank   = rankMap.get(resolved.key) ?? 0;

    insertData.push({
      id:            createId(),
      orgId,
      period,
      topicKey:      resolved.key,
      topicName:     resolved.name,
      topicRank,
      taskSignature: sig,
      memberCount,
      promptVersion: PROMPT_VERSION,
      createdAt:     new Date(),
    });
  }

  // Structural All Knowledge placeholder (kept for backwards compat)
  insertData.push({
    id: createId(), orgId, period,
    topicKey: 'all_knowledge', topicName: 'All Knowledge', topicRank: 9999,
    taskSignature: '', memberCount: 0, promptVersion: 'structural', createdAt: new Date(),
  });

  await prisma.platformMemoryTopic.createMany({ data: insertData });

  // 7. Coverage — all signatures assigned, so always 100%
  const signaturesAssigned  = signatures.length;
  const coverageRatio       = signaturesTotal > 0 ? signaturesAssigned / signaturesTotal : 1;
  const coveragePercent     = Math.round(coverageRatio * 100);
  const pullForwardTriggered = coverageRatio >= COVERAGE_TARGET;
  const belowMinBar         = coverageRatio < COVERAGE_MIN_BAR;

  return {
    ok:                  true,
    period,
    clustersCreated:     domainSigs.size,
    signaturesAssigned,
    signaturesTotal,
    coveragePercent,
    pullForwardTriggered,
    belowMinBar,
    warning:             belowMinBar
      ? `Coverage ${coveragePercent}% is below the minimum bar of ${Math.round(COVERAGE_MIN_BAR * 100)}%.`
      : null,
    error:               null,
  };
}
