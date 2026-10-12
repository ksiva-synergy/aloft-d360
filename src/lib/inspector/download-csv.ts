import { EXPORT_MAX_ROWS } from '@/lib/databricks/export-limits';

/** Client abort before Next route maxDuration (300s) so UI fails clearly. */
const CLIENT_EXPORT_TIMEOUT_MS = 270_000;

export interface InspectorCsvDownloadOpts {
  sql: string;
  filename?: string;
  maxRows?: number;
  toolSlug?: string;
  sessionId?: string;
}

/**
 * POST /api/inspector/export and trigger a browser file download.
 * Buffers the response as a blob (authenticated POST cannot use plain navigation).
 */
export async function downloadInspectorCsv(opts: InspectorCsvDownloadOpts): Promise<{
  truncated: boolean;
  totalRowCount: number | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_EXPORT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('/api/inspector/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: opts.sql,
        filename: opts.filename,
        maxRows: opts.maxRows ?? EXPORT_MAX_ROWS,
        toolSlug: opts.toolSlug,
        sessionId: opts.sessionId,
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      isAbort
        ? 'Export timed out after ~4.5 minutes. The SIRE query is too heavy for streaming export — try SIRE 2.0 only, drop ORDER BY, or add a tighter date filter.'
        : err instanceof Error
          ? err.message
          : 'Export request failed',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const truncated = res.headers.get('X-Export-Truncated') === 'true';
  const totalRaw = res.headers.get('X-Export-Total-Row-Count');
  const totalRowCount = totalRaw != null ? Number(totalRaw) : null;

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/i.exec(disposition);
  const filename = opts.filename ?? match?.[1] ?? 'inspector-export.csv';

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }

  return { truncated, totalRowCount: Number.isFinite(totalRowCount) ? totalRowCount : null };
}
