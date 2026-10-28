'use client';

import { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, XCircle } from 'lucide-react';
import { CONNECTION_FORM_SPECS, connectionFormSpec, type ConnectionFieldSpec } from '@/lib/connections/form-spec';
import type { ConnectionKind } from '@/lib/connections/types';
import { btn, Chip } from '@/views/agent-lab/flows/ui';

const inputClass =
  'h-8 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';
const areaClass =
  'w-full resize-y rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] p-2 font-mono text-size-caption text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

type SavedConnection = { id: string; name: string; kind: string; status: string };

type Issue = { path: string; message: string };

function FieldInput({
  f,
  values,
  set,
  secret,
  issue,
}: {
  f: ConnectionFieldSpec;
  values: Record<string, string>;
  set: (v: Record<string, string>) => void;
  secret: boolean;
  issue?: string;
}) {
  const fid = `inline-conn-${f.key}`;
  return (
    <div>
      <label htmlFor={fid} className="mb-1 block text-size-caption font-medium text-[var(--ink-2)]">
        {f.label}
        {f.optional && <span className="font-normal text-[var(--ink-3)]"> (optional)</span>}
      </label>
      {f.multiline ? (
        <textarea
          id={fid}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          value={values[f.key] ?? ''}
          placeholder={f.placeholder}
          onChange={(e) => set({ ...values, [f.key]: e.target.value })}
          className={areaClass}
        />
      ) : (
        <input
          id={fid}
          type={secret ? 'password' : 'text'}
          autoComplete={secret ? 'new-password' : 'off'}
          spellCheck={false}
          value={values[f.key] ?? ''}
          placeholder={f.placeholder}
          onChange={(e) => set({ ...values, [f.key]: e.target.value })}
          className={`${inputClass}${issue ? ' border-[var(--bad)]' : ''}`}
        />
      )}
      {issue ? (
        <p className="mt-1 text-size-caption text-[var(--bad)]">{issue}</p>
      ) : (
        f.hint && <p className="mt-1 text-size-caption text-[var(--ink-3)]">{f.hint}</p>
      )}
    </div>
  );
}

async function runConnectionTest(id: string): Promise<{ ok: boolean; detail?: string; error?: string; connection?: SavedConnection }> {
  const res = await fetch(`/api/connections/${encodeURIComponent(id)}/test`, { method: 'POST' });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    detail?: string;
    error?: string;
    connection?: SavedConnection;
  };
  return { ok: !!res.ok && !!data.ok, detail: data.detail, error: data.error, connection: data.connection };
}

/**
 * Create a storage connection from Automate (or elsewhere). Credentials POST to `/api/connections`
 * only; they are not written into the workflow draft or sent to Copilot. Matches Govern → Connections:
 * full fields per kind (S3, Azure Blob, SharePoint) and a connection test after save.
 */
export function InlineConnectionCreate({
  preferredKind,
  onCreated,
  onCancel,
}: {
  preferredKind?: ConnectionKind;
  onCreated: (connection: SavedConnection) => void;
  onCancel?: () => void;
}) {
  const [kind, setKind] = useState<ConnectionKind | null>(preferredKind ?? null);
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [testNotice, setTestNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  if (!kind) {
    return (
      <div className="mt-2 rounded-lg border border-[var(--line-1)] bg-[var(--surface-2)] p-3">
        <p className="text-size-caption font-medium text-[var(--ink-2)]">Add a connection</p>
        <p className="mt-1 text-size-caption text-[var(--ink-3)]">
          Amazon S3, Azure Blob or SharePoint — same fields as Govern → Connections. Keys are saved securely and are not sent to Copilot.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CONNECTION_FORM_SPECS.map((s) => (
            <button key={s.kind} type="button" className={btn.secondary} onClick={() => setKind(s.kind)}>
              {s.label}
            </button>
          ))}
          {onCancel && (
            <button type="button" className={btn.ghost} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  const spec = connectionFormSpec(kind);
  const issueFor = (key: string) => issues.find((i) => i.path === key || i.path.endsWith(`.${key}`))?.message;

  const cleanConfig = () =>
    Object.fromEntries(
      Object.entries(config)
        .filter(([, v]) => v?.trim())
        .map(([k, v]) => [k, v.trim()]),
    );

  const saveConnection = async (): Promise<SavedConnection | null> => {
    setError(null);
    setIssues([]);
    setTestNotice(null);
    const res = await fetch(saved ? `/api/connections/${saved.id}` : '/api/connections', {
      method: saved ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        saved
          ? { name: name.trim(), config: cleanConfig(), ...(Object.values(secret).some((v) => v?.trim()) ? { secret } : {}) }
          : { name: name.trim(), kind, config: cleanConfig(), secret, visibility: 'private' },
      ),
    });
    const data = (await res.json().catch(() => ({}))) as {
      connection?: SavedConnection;
      error?: string;
      details?: { issues?: Issue[] };
    };
    if (!res.ok || !data.connection) {
      setIssues(data.details?.issues ?? []);
      setError(data.error ?? `Could not save (${res.status})`);
      return null;
    }
    setSaved(data.connection);
    return data.connection;
  };

  const testSaved = async (conn: SavedConnection) => {
    const result = await runConnectionTest(conn.id);
    const label = conn.name || name.trim();
    if (result.ok) {
      setTestNotice({ tone: 'ok', text: result.detail ? `${label}: ${result.detail}` : `${label}: connected.` });
      onCreated(result.connection ?? conn);
      return true;
    }
    setTestNotice({
      tone: 'bad',
      text: `${label}: ${result.detail ?? result.error ?? 'Connection test failed. Check bucket, region and credentials.'}`,
    });
    if (result.connection) setSaved(result.connection);
    return false;
  };

  const saveAndTest = async () => {
    setBusy(true);
    try {
      const conn = await saveConnection();
      if (!conn) return;
      await testSaved(conn);
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  const testOnly = async () => {
    if (!saved) return;
    setBusy(true);
    setTestNotice(null);
    try {
      await testSaved(saved);
    } catch {
      setTestNotice({ tone: 'bad', text: 'Could not reach the server' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-[var(--line-1)] bg-[var(--surface-2)] p-3">
      <div>
        <p className="text-size-caption font-medium text-[var(--ink-2)]">New {spec.label} connection</p>
        <p className="mt-1 rounded-lg bg-[var(--surface-1)] px-2 py-1.5 text-size-caption text-[var(--ink-2)]">{spec.help}</p>
        <p className="mt-1 text-size-caption text-[var(--ink-3)]">
          Only a connection id is stored on this automation step — not your credentials.
        </p>
      </div>
      {!preferredKind && (
        <button type="button" className={`${btn.ghost} text-size-caption`} onClick={() => setKind(null)}>
          Change storage type
        </button>
      )}

      <div className="space-y-3">
        <FieldInput f={{ key: 'name', label: 'Name', placeholder: 'e.g. Crew certificate scans' }} values={{ name }} set={(v) => setName(v.name ?? '')} secret={false} issue={issueFor('name')} />
        {spec.config.map((f) => (
          <FieldInput key={f.key} f={f} values={config} set={setConfig} secret={false} issue={issueFor(f.key)} />
        ))}
      </div>

      <fieldset className="rounded-lg border border-[var(--line-1)] p-3">
        <legend className="flex items-center gap-1.5 px-1 text-size-caption font-semibold text-[var(--ink-2)]">
          <KeyRound className="h-3.5 w-3.5" aria-hidden /> Credentials
        </legend>
        <p className="mb-3 text-size-caption text-[var(--ink-3)]">Stored in AWS Secrets Manager and never shown again.{saved ? ' Fill in only to replace them.' : ''}</p>
        <div className="space-y-3">
          {spec.secret.map((f) => (
            <FieldInput key={f.key} f={f} values={secret} set={setSecret} secret issue={issueFor(f.key)} />
          ))}
        </div>
      </fieldset>

      {testNotice && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-size-caption ${testNotice.tone === 'ok' ? 'bg-[var(--ok-bg)] text-[var(--ok)]' : 'bg-[var(--bad-bg)] text-[var(--bad)]'}`}
        >
          {testNotice.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span className="break-words">{testNotice.text}</span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-size-caption text-[var(--bad)]">
          {error}
        </p>
      )}
      {saved?.status === 'ok' && (
        <Chip tone="ok">
          <CheckCircle2 className="h-3 w-3" aria-hidden /> Test passed
        </Chip>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.primary} disabled={busy || !name.trim()} onClick={() => void saveAndTest()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : saved && testNotice?.tone === 'bad' ? 'Save and test again' : 'Save and test'}
        </button>
        {saved && testNotice?.tone === 'bad' && (
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => void testOnly()}>
            Test again
          </button>
        )}
        {onCancel && (
          <button type="button" className={btn.ghost} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
