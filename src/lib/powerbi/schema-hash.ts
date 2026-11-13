import { createHash } from 'node:crypto';

/** Hash catalog paths + DAX revision at verification time (build plan §9 schema_hash). */
export function computeSchemaHash(parts: {
  tablesUsed: string[];
  daxHash?: string | null;
  sqlText: string;
}): string {
  const payload = [
    ...parts.tablesUsed.map(t => t.trim().toLowerCase()).sort(),
    parts.daxHash?.trim() ?? '',
    parts.sqlText.trim(),
  ].join('\n');
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}
