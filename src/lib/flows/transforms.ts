import type { FlowStep } from './schema';
import { compare } from './resolve';

// The `transform` executor. Pure functions over already-resolved rows: no I/O and no evaluation of
// user text, so simulation and live runs use this same code.

type TransformConfig = Extract<FlowStep, { type: 'transform' }>['config'];
type Row = Record<string, unknown>;

function rowsOf(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) throw new Error(`${label} must resolve to a list of rows, got ${value === null ? 'null' : typeof value}`);
  return value as Row[];
}

const field = (row: Row, name: string): unknown => (row && typeof row === 'object' ? row[name] : undefined);

/** `config` is the step config after ref resolution, so `input`/`other` hold arrays, not ref strings. */
export function applyTransform(config: TransformConfig): { rows: Row[]; rowCount: number } | { count: number } {
  switch (config.op) {
    case 'filter': {
      const rows = rowsOf(config.input, 'input').filter((r) => compare(field(r, config.field), config.operator, config.value));
      return { rows, rowCount: rows.length };
    }
    case 'limit': {
      const rows = rowsOf(config.input, 'input').slice(0, config.count);
      return { rows, rowCount: rows.length };
    }
    case 'count':
      return { count: rowsOf(config.input, 'input').length };
    case 'anti_join': {
      const otherKey = config.otherKey ?? config.key;
      const present = new Set(rowsOf(config.other, 'other').map((r) => String(field(r, otherKey))));
      const rows = rowsOf(config.input, 'input').filter((r) => !present.has(String(field(r, config.key))));
      return { rows, rowCount: rows.length };
    }
  }
}
