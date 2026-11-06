import type { ObjectT2Context } from './object-t2-context';

export interface HeuristicEntity {
  full_path: string;
  entity_label: string;
  description: string | null;
}

export interface HeuristicJoin {
  from_path: string;
  to_path: string;
  join_on_sql: string;
}

export interface HeuristicDimension {
  column_name: string;
  dimension_label: string;
  dimension_type: string;
}

export interface HeuristicMeasure {
  column_name: string;
  measure_label: string;
  aggregate: string;
}

export interface ClusterProposal {
  entities: Array<{
    full_path: string;
    entity_label: string;
    description?: string | null;
  }>;
  joins: Array<{
    from_path: string;
    to_path: string;
    join_on_sql: string;
    description?: string | null;
  }>;
}

export interface TableProposal {
  full_path: string;
  dimensions: Array<{
    column_name: string;
    dimension_label: string;
    dimension_type: string;
  }>;
  measures: Array<{
    column_name: string;
    measure_label: string;
    aggregate: string;
    metric_type?: string;
  }>;
}

export type T2ContextInput = ObjectT2Context;
