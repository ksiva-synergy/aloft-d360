import type { ClusterProposal, TableProposal } from './proposal-types';

export interface ProposalDiffLine {
  area: 'entity' | 'join' | 'dimension' | 'measure';
  path: string;
  heuristic: string;
  llm: string;
}

export function diffClusterProposals(
  heuristic: ClusterProposal,
  llm: ClusterProposal,
): ProposalDiffLine[] {
  const lines: ProposalDiffLine[] = [];
  const hEnt = new Map(heuristic.entities.map(e => [e.full_path, e]));
  const lEnt = new Map(llm.entities.map(e => [e.full_path, e]));
  const allPaths = new Set([...hEnt.keys(), ...lEnt.keys()]);

  for (const path of allPaths) {
    const h = hEnt.get(path);
    const l = lEnt.get(path);
    const hLabel = h ? `${h.entity_label} | ${h.description ?? ''}` : '(missing)';
    const lLabel = l ? `${l.entity_label} | ${l.description ?? ''}` : '(missing)';
    if (hLabel !== lLabel) {
      lines.push({ area: 'entity', path, heuristic: hLabel, llm: lLabel });
    }
  }

  const joinKey = (j: { from_path: string; to_path: string }) =>
    [j.from_path, j.to_path].sort().join('↔');
  const hJoins = new Map(heuristic.joins.map(j => [joinKey(j), j.join_on_sql]));
  const lJoins = new Map(llm.joins.map(j => [joinKey(j), j.join_on_sql]));
  const allJoins = new Set([...hJoins.keys(), ...lJoins.keys()]);
  for (const key of allJoins) {
    const h = hJoins.get(key) ?? '(none)';
    const l = lJoins.get(key) ?? '(none)';
    if (h !== l) {
      lines.push({ area: 'join', path: key, heuristic: h, llm: l });
    }
  }

  return lines;
}

export function diffTableProposals(
  heuristic: TableProposal,
  llm: TableProposal,
): ProposalDiffLine[] {
  const lines: ProposalDiffLine[] = [];
  const dimCols = new Set([
    ...heuristic.dimensions.map(d => d.column_name),
    ...llm.dimensions.map(d => d.column_name),
  ]);
  for (const col of dimCols) {
    const h = heuristic.dimensions.find(d => d.column_name === col);
    const l = llm.dimensions.find(d => d.column_name === col);
    const hStr = h ? `${h.dimension_label} (${h.dimension_type})` : '(not a dimension)';
    const lStr = l ? `${l.dimension_label} (${l.dimension_type})` : '(not a dimension)';
    if (hStr !== lStr) {
      lines.push({ area: 'dimension', path: `${heuristic.full_path}.${col}`, heuristic: hStr, llm: lStr });
    }
  }

  const measCols = new Set([
    ...heuristic.measures.map(m => m.column_name),
    ...llm.measures.map(m => m.column_name),
  ]);
  for (const col of measCols) {
    const h = heuristic.measures.find(m => m.column_name === col);
    const l = llm.measures.find(m => m.column_name === col);
    const hStr = h ? `${h.measure_label} [${h.aggregate}]` : '(not a measure)';
    const lStr = l ? `${l.measure_label} [${l.aggregate}]` : '(not a measure)';
    if (hStr !== lStr) {
      lines.push({ area: 'measure', path: `${heuristic.full_path}.${col}`, heuristic: hStr, llm: lStr });
    }
  }

  return lines;
}
