/**
 * One vocabulary for the harvest pipeline across Overview, Catalog and Jobs.
 * Each tier shows **technical code + plain name** (e.g. T0 · Structure, Embed · Searchable).
 */
export type EstateStageKey = 'discovered' | 'scanned' | 'profiled' | 'enriched' | 'searchable';

export interface EstateStage {
  key: EstateStageKey;
  /** Technical tier / job shorthand (T0, T1, T2, Embed). */
  label: string;
  /** Plain-language stage name shown beside `label`. */
  plainLabel?: string;
  /** Short explanation for tooltips and helper text. */
  help: string;
  /** Pipeline tier id used in Jobs and scanned-object filters. */
  tier?: 'T0' | 'T1' | 'T2' | 'embed';
  color: string;
}

/** Technical · plain, e.g. `T1 · Profiled`. */
export function estateStageDisplayLabel(stage: Pick<EstateStage, 'label' | 'plainLabel'>): string {
  return stage.plainLabel ? `${stage.label} · ${stage.plainLabel}` : stage.label;
}

export const ESTATE_STAGES: readonly EstateStage[] = [
  { key: 'discovered', label: 'Discovered', help: 'Found in the source catalog. Nothing has been read yet.', color: 'var(--estate-text-muted)' },
  { key: 'scanned', label: 'T0', plainLabel: 'Structure', help: 'Structure scan: tables, columns and types read.', tier: 'T0', color: '#2DD4A0' },
  { key: 'profiled', label: 'T1', plainLabel: 'Profiled', help: 'Profile job: row counts, null rates and value statistics.', tier: 'T1', color: '#5B9DFF' },
  { key: 'enriched', label: 'T2', plainLabel: 'Described', help: 'Semantic enrichment: business descriptions and PII signals.', tier: 'T2', color: '#A78BFA' },
  { key: 'searchable', label: 'Embed', plainLabel: 'Searchable', help: 'Vector embeddings computed for semantic search.', tier: 'embed', color: 'var(--brand-a-ink, var(--brand-a))' },
] as const;

export type ScannedTierId = 't0' | 't1' | 't2' | 'embed' | 't3' | 't4';

export interface EstatePipelineTier {
  id: ScannedTierId;
  label: string;
  plainLabel: string;
  code: string;
  desc: string;
  color: string;
}

/** Full pipeline ladder including T3/T4 (lifecycle badges only; not in overview funnel). */
export const ESTATE_PIPELINE_TIERS: readonly EstatePipelineTier[] = [
  { id: 't0', label: 'T0', plainLabel: 'Structure', code: 'T0', desc: 'columns and types read', color: '#60a5fa' },
  { id: 't1', label: 'T1', plainLabel: 'Profiled', code: 'T1', desc: 'data profile collected', color: '#34d399' },
  { id: 't2', label: 'T2', plainLabel: 'Described', code: 'T2', desc: 'business description written', color: '#a78bfa' },
  { id: 'embed', label: 'Embed', plainLabel: 'Searchable', code: 'Embed', desc: 'vector embeddings', color: '#818CF8' },
  { id: 't3', label: 'T3', plainLabel: 'Linked', code: 'T3', desc: 'usage and joins analysed', color: '#F59E0B' },
  { id: 't4', label: 'T4', plainLabel: 'In model', code: 'T4', desc: 'proposed as a business entity', color: '#F472B6' },
];

export function estateTierDisplayLabel(tier: Pick<EstatePipelineTier, 'label' | 'plainLabel'>): string {
  return `${tier.label} · ${tier.plainLabel}`;
}

export const ESTATE_STAGE: Record<EstateStageKey, EstateStage> = Object.fromEntries(
  ESTATE_STAGES.map((s) => [s.key, s]),
) as Record<EstateStageKey, EstateStage>;

export function formatCount(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-US');
}

export function percentOf(count: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((count / total) * 100));
}
