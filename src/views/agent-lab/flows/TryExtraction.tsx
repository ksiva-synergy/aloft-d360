'use client';

import { useState } from 'react';
import { FileSearch, Loader2 } from 'lucide-react';
import { resolveExtractionSchema } from '@/lib/extraction/schemas';
import { btn } from './ui';

// "Try on a file" for a document.extract step: reads one real document through the step's
// connection with Grok and shows what came back, field by field, with the page and text each value
// was read from. The result can become the step's sample response, so test runs use real output.
// Nothing is saved on the server except an audit entry.

type Field = { value: string | number | null; page: number | null; evidence: string | null; issue?: string };
type Result = {
  documentType: string;
  values: Record<string, unknown>;
  fields: Record<string, Field>;
  missing: string[];
  model: string;
  pages: { sent: number; total: number; truncated: boolean };
  file: { name: string };
};

const field = 'h-8 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 font-mono text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

export function TryExtraction({ stepId, input, onUseAsSample }: { stepId: string; input: Record<string, unknown>; onUseAsSample: (output: Record<string, unknown>) => void }) {
  const connection = typeof input.connection === 'string' ? input.connection : '';
  const key = typeof input.key === 'string' && !input.key.includes('{{') ? input.key : '';
  const [path, setPath] = useState(key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const resolved = resolveExtractionSchema({ schema: input.schema, fields: input.fields });
  const schema = resolved.ok ? resolved.schema : undefined;
  // What the API needs: the built-in schema's name, or the step's own field list.
  const what = Array.isArray(input.fields) ? { fields: input.fields } : { schema: input.schema };

  const missingSetup =
    !connection || connection === 'CHOOSE_CONNECTION'
      ? 'Choose a connection first.'
      : !schema
        ? Array.isArray(input.fields)
          ? 'Finish the field list first.'
          : 'Choose what to read first.'
        : null;

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(connection)}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path.trim(), ...what }),
      });
      const data = (await res.json().catch(() => ({}))) as Result & { error?: string };
      if (!res.ok) setError(data.error ?? `Could not read the file (${res.status})`);
      else setResult(data);
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-size-caption text-[var(--ink-3)]">
        Read one real document with Grok to see what this step will get. The page images are sent to xAI.
      </p>
      <div className="flex gap-2">
        <label htmlFor={`${stepId}-try-path`} className="sr-only">
          File path
        </label>
        <input id={`${stepId}-try-path`} className={field} placeholder="certs/2026/smith-coc.pdf" value={path} onChange={(e) => setPath(e.target.value)} />
        <button type="button" className={btn.secondary} disabled={busy || !!missingSetup || !path.trim()} onClick={() => void run()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />} Try on a file
        </button>
      </div>
      {missingSetup && <p className="text-size-caption text-[var(--ink-3)]">{missingSetup}</p>}
      {error && (
        <p role="alert" className="rounded-lg bg-[var(--bad-bg)] px-2.5 py-2 text-size-caption text-[var(--bad)]">
          {error}
        </p>
      )}
      {result && schema && (
        <div className="rounded-xl border border-[var(--line-1)]">
          <p className="border-b border-[var(--line-1)] px-3 py-2 text-size-caption text-[var(--ink-2)]">
            <span className="font-semibold text-[var(--ink-1)]">{result.file.name}</span> · {result.documentType || 'document'} · {result.pages.sent} of {result.pages.total} page{result.pages.total === 1 ? '' : 's'} read
            {result.pages.truncated ? ' (page limit reached)' : ''}
          </p>
          <table aria-label="Extracted fields" className="w-full text-left text-size-caption">
            <tbody>
              {Object.entries(schema.fields).map(([k, f]) => {
                const v = result.fields[k];
                return (
                  <tr key={k} className="border-b border-[var(--line-1)] last:border-0 align-top">
                    <th scope="row" className="w-2/5 px-3 py-1.5 font-medium text-[var(--ink-2)]">
                      {f.label}
                    </th>
                    <td className="px-3 py-1.5">
                      {v?.value !== null && v?.value !== undefined ? (
                        <>
                          <span className="text-[var(--ink-1)]">{String(v.value)}</span>
                          {v.evidence && (
                            <span className="mt-0.5 block text-[var(--ink-3)]" title="Text the value was read from">
                              “{v.evidence}”{v.page ? ` · page ${v.page}` : ''}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[var(--ink-3)]">{v?.issue ? `Not accepted: ${v.issue}` : 'Not found'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--line-1)] px-3 py-2">
            <span className="text-size-caption text-[var(--ink-3)]">Read by {result.model}. Check the values against the document.</span>
            <button
              type="button"
              className={btn.ghost}
              onClick={() => {
                const { documentType, values, fields, missing } = result;
                onUseAsSample({ schema: schema.name, documentType, values, fields, missing });
              }}
            >
              Use as sample response
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
