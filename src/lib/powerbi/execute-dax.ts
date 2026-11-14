import 'server-only';

/**
 * Power BI "Execute DAX Queries In Group" client (Arrow IPC responses).
 *
 * Why: the older executeQueries (JSON) API rejects service principals on RLS semantic models
 * (401 PowerBINotAuthorizedException, verified on CII SDK-2026). executeDaxQueries accepts a
 * service principal that is workspace Admin, and RLS is not applied to it — it sees all rows,
 * which is what parity needs (SQL reads all rows too). Verified 2026-11-14 on CII SDK.
 *
 * Response: one or more concatenated Arrow IPC streams, record batches LZ4_FRAME-compressed;
 * query errors arrive as HTTP 200 with an error rowset (schema metadata IsError = "true").
 */

import { CompressionType, DataType, RecordBatchReader, compressionRegistry, type Field } from 'apache-arrow';

import { PowerBiApiError, getPowerBiAccessToken } from '@/lib/powerbi/client';
import { lz4FrameDecode } from '@/lib/powerbi/lz4-frame';

let codecRegistered = false;
function ensureCodec() {
  if (codecRegistered) return;
  compressionRegistry.set(CompressionType.LZ4_FRAME, { decode: (data: Uint8Array) => lz4FrameDecode(data) });
  codecRegistered = true;
}

/** Arrow cell → plain JSON-friendly value (bigint → number, dates → ISO strings). */
function plain(value: unknown, field: Field): unknown {
  if (value === null || value === undefined) return null;
  const temporal = DataType.isTimestamp(field.type) || DataType.isDate(field.type);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return temporal ? new Date(Number(value)).toISOString() : Number(value);
  if (temporal && typeof value === 'number') return new Date(value).toISOString();
  return value;
}

export type DaxRowset = { columns: string[]; rows: Record<string, unknown>[] };

/** Decode an executeDaxQueries response body. Throws on an error rowset. */
export function decodeDaxArrow(body: Uint8Array): DaxRowset[] {
  ensureCodec();
  const out: DaxRowset[] = [];
  for (const reader of RecordBatchReader.readAll(body)) {
    const fields = reader.schema.fields;
    const rows: Record<string, unknown>[] = [];
    for (const batch of reader) {
      for (let r = 0; r < batch.numRows; r++) {
        const row: Record<string, unknown> = {};
        fields.forEach((f, c) => {
          row[f.name] = plain(batch.getChildAt(c)?.get(r), f);
        });
        rows.push(row);
      }
    }
    if (reader.schema.metadata.get('IsError') === 'true') {
      const e = rows[0] ?? {};
      throw new PowerBiApiError(
        `DAX error ${String(e.ErrorCode ?? '')}: ${String(e.ErrorMessage ?? e.ErrorDescription ?? reader.schema.metadata.get('FaultString') ?? 'unknown')}`.slice(0, 600),
        200,
      );
    }
    out.push({ columns: fields.map((f) => f.name), rows });
  }
  return out;
}

export async function executeDaxQueries(
  workspaceId: string,
  datasetId: string,
  query: string,
  opts: { queryTimeoutSec?: number; rowLimit?: number } = {},
): Promise<DaxRowset[]> {
  const token = await getPowerBiAccessToken();
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeDaxQueries`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        queryTimeout: opts.queryTimeoutSec ?? 300,
        ...(opts.rowLimit ? { resultSetRowCountLimit: opts.rowLimit } : {}),
      }),
      signal: AbortSignal.timeout(((opts.queryTimeoutSec ?? 300) + 60) * 1000),
    });
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get('Retry-After') ?? '10');
      await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 1), 60) * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PowerBiApiError(`executeDaxQueries ${datasetId} → ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return decodeDaxArrow(new Uint8Array(await res.arrayBuffer()));
  }
}
