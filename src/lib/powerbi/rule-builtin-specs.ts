/**
 * Differential-test specs for the compiler's built-in DAX scalar functions, so the hand-written
 * core library is proven against Power BI the same way registry rules are.
 */

import type { FunctionTestSpec } from '@/lib/powerbi/rule-difftest';

export const BUILTIN_FUNCTION_SPECS: FunctionTestSpec[] = [
  // dates
  { name: 'WEEKNUM', args: [{ kind: 'date' }, { kind: 'int', literals: ['1', '2', '21'] }] },
  { name: 'YEAR', args: [{ kind: 'date' }] },
  { name: 'MONTH', args: [{ kind: 'date' }] },
  { name: 'DAY', args: [{ kind: 'date' }] },
  { name: 'QUARTER', args: [{ kind: 'date' }] },
  { name: 'WEEKDAY', args: [{ kind: 'date' }] },
  { name: 'EDATE', args: [{ kind: 'date' }, { kind: 'int', literals: ['1', '-1', '12'] }] },
  { name: 'EOMONTH', args: [{ kind: 'date' }, { kind: 'int', literals: ['0', '1', '-1'] }] },
  { name: 'DATEDIFF', args: [{ kind: 'date' }, { kind: 'date' }, { kind: 'int', literals: ['DAY', 'MONTH', 'YEAR', 'WEEK', 'QUARTER'] }] },
  { name: 'FORMAT', args: [{ kind: 'date' }, { kind: 'string', literals: ['"YYYYMMDD"', '"MMM YYYY"', '"Q YYYY"', '"dddd"', '"mmm-YYYY"'] }] },
  // text
  { name: 'TRIM', args: [{ kind: 'string' }] },
  { name: 'UPPER', args: [{ kind: 'string' }] },
  { name: 'LOWER', args: [{ kind: 'string' }] },
  { name: 'LEN', args: [{ kind: 'string' }] },
  { name: 'LEFT', args: [{ kind: 'string' }, { kind: 'int', literals: ['0', '2', '20'] }] },
  { name: 'RIGHT', args: [{ kind: 'string' }, { kind: 'int', literals: ['0', '2', '20'] }] },
  { name: 'CONTAINSSTRING', args: [{ kind: 'string' }, { kind: 'string', literals: ['"hello"', '"B"', '""'] }] },
  { name: 'COMBINEVALUES', args: [{ kind: 'string', literals: ['"-"'] }, { kind: 'string' }, { kind: 'string' }] },
  // math / logic
  { name: 'ROUND', args: [{ kind: 'number' }, { kind: 'int', literals: ['0', '1', '-1'] }] },
  { name: 'INT', args: [{ kind: 'number' }] },
  { name: 'ABS', args: [{ kind: 'number' }] },
  { name: 'MOD', args: [{ kind: 'number' }, { kind: 'number', literals: ['3', '-3'] }] },
  { name: 'DIVIDE', args: [{ kind: 'number' }, { kind: 'number' }] },
  { name: 'ISBLANK', args: [{ kind: 'number' }] },
  { name: 'COALESCE', args: [{ kind: 'number' }, { kind: 'number', literals: ['0'] }] },
];
