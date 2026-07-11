import Ajv from 'ajv';
import schema from './chart-dsl.schema.json';
import type { ChartDSLSpec, ChartKind, ChartEncoding } from './chart-dsl';
import type { ProfileResult } from './types';

const ajv = new Ajv({ allErrors: true, useDefaults: true });
const validate = ajv.compile(schema);

const VALID_KINDS: ChartKind[] = [
  'bar', 'stacked-bar', 'line', 'area', 'pie',
  'scatter', 'heatmap', 'boxplot', 'histogram',
];

const VALID_ROLES: ChartEncoding['role'][] = ['x', 'y', 'series', 'value', 'color', 'size'];

export interface ValidationError {
  path: string;
  message: string;
  repaired: boolean;
}

export interface ValidationResult {
  valid: boolean;
  spec: ChartDSLSpec | null;
  errors: ValidationError[];
  rejected: boolean;
  rejectionReason?: string;
}

// Per-kind minimum encoding arity table.
// Each entry: { [role]: minCount }. "numeric" flag means the column must resolve to a numeric kind.
interface ArityRule {
  required: Record<string, number>;
  numericRoles?: string[];
}

const ARITY_TABLE: Record<ChartKind, ArityRule> = {
  bar:           { required: { x: 1, y: 1 } },
  'stacked-bar': { required: { x: 1, y: 1, series: 1 } },
  line:          { required: { x: 1, y: 1 } },
  area:          { required: { x: 1, y: 1 } },
  pie:           { required: { x: 1, y: 1 } },
  scatter:       { required: { x: 1, y: 1 }, numericRoles: ['y'] },
  heatmap:       { required: { x: 1, y: 1, value: 1 } },
  boxplot:       { required: { x: 1, y: 1 }, numericRoles: ['y'] },
  histogram:     { required: { x: 1 }, numericRoles: ['x'] },
};

function isNumericKind(kind: string): boolean {
  return kind === 'numeric_continuous' || kind === 'numeric_discrete';
}

function countByRole(encodings: ChartEncoding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const enc of encodings) {
    counts[enc.role] = (counts[enc.role] || 0) + 1;
  }
  return counts;
}

function getColumnKind(columnId: string, profile: ProfileResult): string | undefined {
  const col = profile.profiles.find(p => p.name === columnId);
  return col?.kind;
}

/**
 * Validates a raw input against the Chart DSL schema and applies deterministic
 * mechanical repairs. No model call — all transforms are rule-based.
 */
export function validateAndRepair(raw: unknown, profile: ProfileResult): ValidationResult {
  const errors: ValidationError[] = [];

  // Reject non-objects immediately
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      spec: null,
      errors: [{ path: '', message: 'Input is not an object', repaired: false }],
      rejected: true,
      rejectionReason: 'Input is not an object',
    };
  }

  const obj = { ...(raw as Record<string, unknown>) };

  // Reject if id is missing or not a string
  if (!obj.id || typeof obj.id !== 'string') {
    return {
      valid: false,
      spec: null,
      errors: [{ path: '/id', message: '`id` is missing or not a string', repaired: false }],
      rejected: true,
      rejectionReason: '`id` is missing or not a string',
    };
  }

  // Reject if title is missing or not a string
  if (!obj.title || typeof obj.title !== 'string') {
    return {
      valid: false,
      spec: null,
      errors: [{ path: '/title', message: '`title` is missing or not a string', repaired: false }],
      rejected: true,
      rejectionReason: '`title` is missing or not a string',
    };
  }

  // 1. Clamp kind — if not in enum, fall back to 'bar'
  if (typeof obj.kind !== 'string' || !VALID_KINDS.includes(obj.kind as ChartKind)) {
    errors.push({ path: '/kind', message: `Invalid kind "${obj.kind}", clamped to "bar"`, repaired: true });
    obj.kind = 'bar';
  }

  // 2. Drop unknown top-level fields
  const KNOWN_FIELDS = new Set(['id', 'kind', 'title', 'subtitle', 'encodings', 'filters', 'sort', 'limit', 'themeSlot']);
  for (const key of Object.keys(obj)) {
    if (!KNOWN_FIELDS.has(key)) {
      errors.push({ path: `/${key}`, message: `Unknown field "${key}" removed`, repaired: true });
      delete obj[key];
    }
  }

  // 3. Coerce limit to integer, clamp to [1, 10000]
  if (obj.limit !== undefined) {
    const num = Number(obj.limit);
    if (isNaN(num)) {
      errors.push({ path: '/limit', message: `Non-numeric limit removed`, repaired: true });
      delete obj.limit;
    } else {
      const clamped = Math.max(1, Math.min(10000, Math.round(num)));
      if (clamped !== obj.limit) {
        errors.push({ path: '/limit', message: `limit clamped to ${clamped}`, repaired: true });
        obj.limit = clamped;
      }
    }
  }

  // 4. Fill required defaults
  if (!obj.themeSlot) {
    obj.themeSlot = 'aloft-dark';
  }
  if (Array.isArray(obj.encodings)) {
    for (const enc of obj.encodings as Record<string, unknown>[]) {
      if (enc && typeof enc === 'object' && !enc.aggregate) {
        enc.aggregate = 'none';
      }
    }
  }

  // Ensure encodings is an array
  if (!Array.isArray(obj.encodings)) {
    return {
      valid: false,
      spec: null,
      errors: [{ path: '/encodings', message: '`encodings` is not an array', repaired: false }],
      rejected: true,
      rejectionReason: '`encodings` is missing or not an array',
    };
  }

  // 7. Coerce encoding roles — drop encodings with invalid role
  const validColumnNames = new Set(profile.profiles.map(p => p.name));
  let encodings = obj.encodings as Record<string, unknown>[];

  encodings = encodings.filter((enc, i) => {
    if (!enc || typeof enc !== 'object') {
      errors.push({ path: `/encodings/${i}`, message: 'Non-object encoding removed', repaired: true });
      return false;
    }
    // Validate role
    if (typeof enc.role !== 'string' || !VALID_ROLES.includes(enc.role as ChartEncoding['role'])) {
      errors.push({ path: `/encodings/${i}/role`, message: `Invalid role "${enc.role}" — encoding dropped`, repaired: true });
      return false;
    }
    return true;
  });

  // 5. Validate columnId references
  encodings = encodings.filter((enc, i) => {
    if (typeof enc.columnId !== 'string' || !validColumnNames.has(enc.columnId)) {
      errors.push({ path: `/encodings/${i}/columnId`, message: `Unknown column "${enc.columnId}" — encoding dropped`, repaired: true });
      return false;
    }
    return true;
  });

  // Reject if no valid encodings remain
  if (encodings.length === 0) {
    return {
      valid: false,
      spec: null,
      errors: [...errors, { path: '/encodings', message: 'No valid encodings remain after pruning', repaired: false }],
      rejected: true,
      rejectionReason: 'No valid encodings remain after column-id pruning',
    };
  }

  obj.encodings = encodings;

  // 8. Per-kind encoding arity repair
  let kind = obj.kind as ChartKind;
  const typedEncodings = encodings as unknown as ChartEncoding[];
  const roleCounts = countByRole(typedEncodings);

  // 6. stacked-bar without series → downgrade to bar
  if (kind === 'stacked-bar' && !roleCounts['series']) {
    errors.push({ path: '/kind', message: 'stacked-bar with no series encoding — downgraded to bar', repaired: true });
    kind = 'bar';
    obj.kind = 'bar';
  }

  // Pie arity: excess y encodings dropped to 1
  if (kind === 'pie' && (roleCounts['y'] || 0) > 1) {
    let kept = 0;
    obj.encodings = typedEncodings.filter(enc => {
      if (enc.role === 'y') {
        kept++;
        if (kept > 1) {
          errors.push({ path: '/encodings', message: 'pie: excess y encoding dropped (only 1 allowed)', repaired: true });
          return false;
        }
      }
      return true;
    });
  }

  // Check arity rules and downgrade if needed
  const arityRule = ARITY_TABLE[kind];
  if (arityRule) {
    const currentCounts = countByRole(obj.encodings as unknown as ChartEncoding[]);
    let arityFail = false;

    for (const [role, minCount] of Object.entries(arityRule.required)) {
      if ((currentCounts[role] || 0) < minCount) {
        arityFail = true;
        break;
      }
    }

    // Check numeric constraints
    if (!arityFail && arityRule.numericRoles) {
      for (const role of arityRule.numericRoles) {
        const roleEncodings = (obj.encodings as unknown as ChartEncoding[]).filter(e => e.role === role);
        const allNumeric = roleEncodings.every(e => {
          const colKind = getColumnKind(e.columnId, profile);
          return colKind ? isNumericKind(colKind) : false;
        });
        if (!allNumeric) {
          arityFail = true;
          break;
        }
      }
    }

    // Downgrade path
    if (arityFail) {
      const downgradeTo = getDowngradeTarget(kind);
      if (downgradeTo) {
        errors.push({ path: '/kind', message: `${kind} failed arity check — downgraded to ${downgradeTo}`, repaired: true });
        obj.kind = downgradeTo;
      } else {
        return {
          valid: false,
          spec: null,
          errors: [...errors, { path: '/kind', message: `${kind} failed arity check and no downgrade available`, repaired: false }],
          rejected: true,
          rejectionReason: `Chart kind "${kind}" cannot be rendered with the available encodings`,
        };
      }
    }
  }

  // Run ajv validation on the repaired object
  const isValid = validate(obj);
  if (!isValid && validate.errors) {
    for (const err of validate.errors) {
      const path = err.instancePath || '';
      const msg = err.message || 'Unknown validation error';
      errors.push({ path, message: msg, repaired: false });
    }
    return {
      valid: false,
      spec: null,
      errors,
      rejected: true,
      rejectionReason: `Schema validation failed after repair: ${validate.errors.map(e => e.message).join('; ')}`,
    };
  }

  return {
    valid: errors.length === 0,
    spec: obj as unknown as ChartDSLSpec,
    errors,
    rejected: false,
  };
}

function getDowngradeTarget(kind: ChartKind): ChartKind | null {
  const DOWNGRADE_MAP: Partial<Record<ChartKind, ChartKind>> = {
    'stacked-bar': 'bar',
    heatmap: 'bar',
    boxplot: 'bar',
    scatter: 'bar',
    pie: 'bar',
    histogram: 'bar',
  };
  return DOWNGRADE_MAP[kind] || null;
}
