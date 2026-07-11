export interface ColumnProfile {
  name: string;
  declaredType: string;            // STRING | LONG | DECIMAL | DATE | ...
  kind: 'temporal' | 'categorical' | 'numeric_continuous' | 'numeric_discrete'
      | 'identifier' | 'boolean' | 'text';
  cardinality: number;
  nullRate: number;
  min?: number | string; max?: number | string;
  topValues?: { value: string; count: number }[];   // top 5
  stats?: { mean: number; median: number; p95: number };
  sorted?: 'asc' | 'desc' | 'none';
}

export type { ChartKind, ChartEncoding, ChartFilter, ChartSort, ChartDSLSpec } from './chart-dsl';

export interface ChartSpec {
  id: string;
  kind: 'kpi' | 'bar' | 'line' | 'donut' | 'scatter' | 'heatmap' | 'histogram';
  title: string;
  rationale: string;               // one-line mono, e.g. "temporal × numeric → trend"
  x?: string; y?: string[]; series?: string; value?: string;
  echartsOption: object;           // fully resolved option, theme-agnostic colors
  dsl?: import('./chart-dsl').ChartDSLSpec; // source DSL spec; absent in legacy persisted rows
  rank: number;                    // recommender priority
  alternatives: string[];          // ids of other viable specs for the swap menu
}

export interface ProfileResult {
  profiles: ColumnProfile[];
  columnsTruncated: boolean; // true if > 50 columns were present (before cap)
  rowsSampled: number;       // rows.length (may be < rowCount if truncated)
}
