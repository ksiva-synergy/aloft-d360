import type { DomainDefinition } from '@/lib/powerbi/domain-registry';

export type DomainScoreSignal = {
  source: string;
  domain_key: string;
  weight: number;
  detail?: string;
};

export type DomainScoreResult = {
  domain_key: string;
  confidence: number;
  signals: DomainScoreSignal[];
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function countLexiconHits(corpus: string, lexicon: string[]): number {
  const tokens = new Set(tokenize(corpus));
  let hits = 0;
  for (const kw of lexicon) {
    const k = kw.toLowerCase();
    if (tokens.has(k) || corpus.toLowerCase().includes(k)) hits += 1;
  }
  return hits;
}

export function scoreModelDomains(input: {
  domains: DomainDefinition[];
  modelName: string;
  workspaceName: string | null;
  workspaceDomainHint: string | null;
  measureNames: string[];
  measureFolders: string[];
  catalogDomainKeywords: string[];
}): DomainScoreResult[] {
  const corpusParts = [
    input.modelName,
    input.workspaceName ?? '',
    input.measureNames.join(' '),
    input.measureFolders.join(' '),
    input.catalogDomainKeywords.join(' '),
  ];
  const corpus = corpusParts.join(' ');

  const scores: DomainScoreResult[] = [];

  for (const domain of input.domains) {
    const signals: DomainScoreSignal[] = [];
    let total = 0;

    for (const kw of input.catalogDomainKeywords) {
      if (domain.lexicon.some((l) => kw.toLowerCase().includes(l) || l.includes(kw.toLowerCase()))) {
        signals.push({ source: 'catalog_object', domain_key: domain.domain_key, weight: 3, detail: kw });
        total += 3;
      }
    }

    if (input.workspaceDomainHint?.toLowerCase() === domain.domain_key) {
      signals.push({ source: 'workspace_hint', domain_key: domain.domain_key, weight: 4 });
      total += 4;
    }

    const wsHits = countLexiconHits(input.workspaceName ?? '', domain.lexicon);
    if (wsHits > 0) {
      signals.push({ source: 'workspace_name', domain_key: domain.domain_key, weight: wsHits });
      total += wsHits;
    }

    const modelHits = countLexiconHits(input.modelName, domain.lexicon);
    if (modelHits > 0) {
      signals.push({ source: 'model_name', domain_key: domain.domain_key, weight: modelHits * 2 });
      total += modelHits * 2;
    }

    const textHits = countLexiconHits(corpus, domain.lexicon);
    if (textHits > 0) {
      signals.push({ source: 'lexicon', domain_key: domain.domain_key, weight: textHits });
      total += textHits;
    }

    if (total > 0) {
      scores.push({
        domain_key: domain.domain_key,
        confidence: total,
        signals,
      });
    }
  }

  scores.sort((a, b) => b.confidence - a.confidence);
  return scores;
}

export function pickPrimaryDomain(scores: DomainScoreResult[]): DomainScoreResult | null {
  return scores[0] ?? null;
}

export type MeasureConflictRow = {
  metric_key: string;
  metric_name: string;
  model_ids: string[];
  domain_keys: string[];
  dax_hashes: string[];
  summary: string;
};

export function detectMeasureNameConflicts(
  rows: Array<{
    model_id: string;
    domain_key: string | null;
    measure_name: string;
    dax_hash: string | null;
  }>,
): MeasureConflictRow[] {
  const byKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.measure_name.trim().toLowerCase();
    if (!key) continue;
    const bucket = byKey.get(key) ?? [];
    bucket.push(row);
    byKey.set(key, bucket);
  }

  const out: MeasureConflictRow[] = [];
  for (const [metric_key, group] of byKey) {
    const models = new Set(group.map((g) => g.model_id));
    if (models.size < 2) continue;
    const hashes = new Set(group.map((g) => g.dax_hash ?? '').filter(Boolean));
    if (hashes.size <= 1) continue;
    const metric_name = group[0].measure_name;
    const domain_keys = [...new Set(group.map((g) => g.domain_key).filter(Boolean) as string[])];
    out.push({
      metric_key,
      metric_name,
      model_ids: [...models],
      domain_keys,
      dax_hashes: [...hashes],
      summary: `Same measure name in ${models.size} models with ${hashes.size} distinct DAX hashes`,
    });
  }
  return out;
}
