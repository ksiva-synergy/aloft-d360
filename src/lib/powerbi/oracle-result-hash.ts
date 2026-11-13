import { createHash } from 'node:crypto';

export function hashOracleRows(rows: unknown): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
