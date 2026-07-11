export type ChartKind =
  | 'bar' | 'stacked-bar' | 'line' | 'area'
  | 'pie' | 'scatter' | 'heatmap' | 'boxplot' | 'histogram';

export interface ChartEncoding {
  columnId: string;
  role: 'x' | 'y' | 'series' | 'value' | 'color' | 'size';
  aggregate?: 'sum' | 'mean' | 'count' | 'min' | 'max' | 'median' | 'none';
}

export interface ChartFilter {
  columnId: string;
  op: 'eq' | 'neq' | 'gt' | 'lt' | 'in';
  value: unknown;
}

export interface ChartSort {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface ChartDSLSpec {
  id: string;
  kind: ChartKind;
  title: string;
  subtitle?: string;
  encodings: ChartEncoding[];
  filters?: ChartFilter[];
  sort?: ChartSort;
  limit?: number;
  themeSlot?: 'aloft-dark' | 'aloft-light';
}
