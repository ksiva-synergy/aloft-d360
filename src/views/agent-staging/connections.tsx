"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  File,
  FolderClosed,
  FolderOpen,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, btn } from "@/views/agent-lab/flows/ui";

// Storage connections: Amazon S3 (access key + secret + region), Azure Blob (connection string) and
// SharePoint (Entra tenant + app via Microsoft Graph). Credentials are write-only here: they go to
// AWS Secrets Manager and are never shown again. Self-service: anyone who builds automations adds
// their own; a connection is private to its owner until they share it with the organisation. Who may
// change what is decided by the server (`canManage`); this page only reflects it.

type Kind = "s3" | "azure_blob" | "sharepoint";
type Connection = {
  id: string;
  name: string;
  kind: Kind;
  config: Record<string, string | undefined>;
  status: string;
  lastTestedAt: string | null;
  lastError: string | null;
  updatedAt: string;
  visibility?: "private" | "org";
  ownerName?: string | null;
  mine?: boolean;
  canManage?: boolean;
};
type Issue = { path: string; message: string };
type Item = {
  name: string;
  path: string;
  isFolder: boolean;
  size?: number;
  modified?: string;
};
type FieldSpec = {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  multiline?: boolean;
};

const KINDS: {
  kind: Kind;
  label: string;
  Icon: typeof Cloud;
  blurb: string;
  config: FieldSpec[];
  secret: FieldSpec[];
  help: ReactNode;
}[] = [
  {
    kind: "s3",
    label: "Amazon S3",
    Icon: Database,
    blurb: "A bucket, with an access key and secret.",
    config: [
      { key: "region", label: "Region", placeholder: "ap-south-1" },
      { key: "bucket", label: "Bucket", placeholder: "my-company-documents" },
      {
        key: "rootFolder",
        label: "Root folder",
        placeholder: "invoices/2026",
        optional: true,
        hint: "Only this folder and below can be read. Leave empty for the whole bucket.",
      },
    ],
    secret: [
      { key: "accessKeyId", label: "Access key ID", placeholder: "AKIA…" },
      { key: "secretAccessKey", label: "Secret access key" },
    ],
    help: "Use an IAM user that can only read this bucket (s3:ListBucket and s3:GetObject on it).",
  },
  {
    kind: "azure_blob",
    label: "Azure Blob Storage",
    Icon: Cloud,
    blurb: "A container, with a connection string.",
    config: [
      { key: "container", label: "Container", placeholder: "documents" },
      {
        key: "rootFolder",
        label: "Root folder",
        optional: true,
        hint: "Only this folder and below can be read.",
      },
    ],
    secret: [
      {
        key: "connectionString",
        label: "Connection string",
        placeholder:
          "DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…;EndpointSuffix=core.windows.net",
        multiline: true,
      },
    ],
    help: "Azure portal → Storage account → Access keys. A SAS connection string with only Read and List rights is safer than the account key.",
  },
  {
    kind: "sharepoint",
    label: "SharePoint",
    Icon: Share2,
    blurb: "A site, through Microsoft Graph with an Entra app.",
    config: [
      {
        key: "tenantId",
        label: "Tenant ID",
        placeholder:
          "00000000-0000-0000-0000-000000000000 or contoso.onmicrosoft.com",
      },
      {
        key: "clientId",
        label: "Application (client) ID",
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      {
        key: "siteUrl",
        label: "Site URL",
        placeholder: "https://contoso.sharepoint.com/sites/Finance",
      },
      {
        key: "library",
        label: "Document library",
        placeholder: "Documents",
        optional: true,
        hint: "Leave empty for the site’s default library.",
      },
      { key: "rootFolder", label: "Root folder", optional: true },
    ],
    secret: [{ key: "clientSecret", label: "Client secret" }],
    help: "Register an app in Microsoft Entra ID, add a client secret, and give it the Microsoft Graph application permission Sites.Selected (then grant it read access to this site) or Sites.Read.All, with admin consent.",
  },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<
  Kind,
  (typeof KINDS)[number]
>;

const field =
  "h-9 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2.5 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]";

async function readJson<T>(
  res: Response,
): Promise<T & { error?: string; details?: { issues?: Issue[] } }> {
  return (await res.json().catch(() => ({}))) as T & {
    error?: string;
    details?: { issues?: Issue[] };
  };
}

function where(c: Connection): string {
  const f = c.config;
  const root = f.rootFolder ? `/${f.rootFolder}` : "";
  if (c.kind === "s3") return `s3://${f.bucket}${root} · ${f.region}`;
  if (c.kind === "azure_blob")
    return `${f.accountName ?? "?"} / ${f.container}${root}`;
  return `${f.siteUrl?.replace(/^https:\/\//, "")}${f.library ? ` › ${f.library}` : ""}${root}`;
}

function SharingChip({ c }: { c: Connection }) {
  if (c.visibility === "org")
    return (
      <Chip>
        <Users className="h-3 w-3" aria-hidden />{" "}
        {c.mine ? "Shared" : `Shared by ${c.ownerName ?? "a colleague"}`}
      </Chip>
    );
  return (
    <Chip>
      <Lock className="h-3 w-3" aria-hidden />{" "}
      {c.mine ? "Only you" : `Private to ${c.ownerName ?? "its owner"}`}
    </Chip>
  );
}

function StatusChip({ c }: { c: Connection }) {
  if (c.status === "ok")
    return (
      <Chip tone="ok">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </Chip>
    );
  if (c.status === "error")
    return (
      <Chip tone="bad">
        <AlertTriangle className="h-3 w-3" /> Failed
      </Chip>
    );
  return <Chip>Not tested</Chip>;
}

const size = (n?: number) =>
  n === undefined
    ? ""
    : n < 1024
      ? `${n} B`
      : n < 1048576
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;

// ── Add / edit form ──────────────────────────────────────────────────────────

function ConnectionForm({
  existing,
  onDone,
  onCancel,
}: {
  existing: Connection | null;
  onDone: (c: Connection) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<Kind | null>(existing?.kind ?? null);
  const [name, setName] = useState(existing?.name ?? "");
  const [config, setConfig] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        Object.entries(existing?.config ?? {}).filter(
          ([k, v]) => k !== "accountName" && v !== undefined,
        ),
      ) as Record<string, string>,
  );
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<"private" | "org">(
    existing?.visibility ?? "private",
  );
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!kind) {
    return (
      <div>
        <h2 className="text-size-body-lg font-semibold text-[var(--ink-1)]">
          Add a connection
        </h2>
        <p className="mt-1 text-size-ui text-[var(--ink-3)]">
          Choose where your files are.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {KINDS.map(({ kind: k, label, Icon, blurb }) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className="flex flex-col items-start gap-2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4 text-left hover:border-[var(--brand-a)]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--ink-2)]">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-size-ui font-semibold text-[var(--ink-1)]">
                {label}
              </span>
              <span className="text-size-caption text-[var(--ink-3)]">
                {blurb}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className={cn(btn.ghost, "mt-4")}
        >
          Cancel
        </button>
      </div>
    );
  }

  const spec = KIND[kind];
  const issueFor = (key: string) =>
    issues.find((i) => i.path === key || i.path.endsWith(`.${key}`))?.message;
  const secretTouched = spec.secret.some((f) => secret[f.key]?.trim());

  const submit = async () => {
    setBusy(true);
    setIssues([]);
    setError(null);
    const cleanConfig = Object.fromEntries(
      Object.entries(config)
        .filter(([, v]) => v?.trim())
        .map(([k, v]) => [k, v.trim()]),
    );
    const body = existing
      ? {
          name,
          config: cleanConfig,
          visibility,
          ...(secretTouched ? { secret } : {}),
        }
      : { name, kind, config: cleanConfig, secret, visibility };
    try {
      const res = await fetch(
        existing ? `/api/connections/${existing.id}` : "/api/connections",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await readJson<{ connection?: Connection }>(res);
      if (!res.ok || !data.connection) {
        setIssues(data.details?.issues ?? []);
        return setError(data.error ?? `Could not save (${res.status})`);
      }
      onDone(data.connection);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  const renderField = (
    f: FieldSpec,
    values: Record<string, string>,
    set: (v: Record<string, string>) => void,
    secretField: boolean,
  ) => {
    const id = `conn-${f.key}`;
    const msg = issueFor(f.key);
    return (
      <div key={f.key}>
        <label
          htmlFor={id}
          className="mb-1 block text-size-caption font-medium text-[var(--ink-2)]"
        >
          {f.label}
          {f.optional && (
            <span className="font-normal text-[var(--ink-3)]"> (optional)</span>
          )}
        </label>
        {f.multiline ? (
          <textarea
            id={id}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            value={values[f.key] ?? ""}
            placeholder={
              secretField && existing
                ? "Leave empty to keep the current value"
                : f.placeholder
            }
            onChange={(e) => set({ ...values, [f.key]: e.target.value })}
            className={cn(field, "h-auto py-2 font-mono")}
          />
        ) : (
          <input
            id={id}
            type={secretField ? "password" : "text"}
            autoComplete={secretField ? "new-password" : "off"}
            spellCheck={false}
            value={values[f.key] ?? ""}
            placeholder={
              secretField && existing
                ? "Leave empty to keep the current value"
                : f.placeholder
            }
            onChange={(e) => set({ ...values, [f.key]: e.target.value })}
            className={cn(field, msg && "border-[var(--bad)]")}
          />
        )}
        {msg ? (
          <p className="mt-1 text-size-caption text-[var(--bad)]">{msg}</p>
        ) : (
          f.hint && (
            <p className="mt-1 text-size-caption text-[var(--ink-3)]">
              {f.hint}
            </p>
          )
        )}
      </div>
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2">
        {!existing && (
          <button
            type="button"
            aria-label="Choose another kind"
            onClick={() => setKind(null)}
            className={btn.icon}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <h2 className="text-size-body-lg font-semibold text-[var(--ink-1)]">
          {existing ? `Edit ${existing.name}` : `New ${spec.label} connection`}
        </h2>
      </div>
      <p className="mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-size-caption text-[var(--ink-2)]">
        {spec.help}
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label
            htmlFor="conn-name"
            className="mb-1 block text-size-caption font-medium text-[var(--ink-2)]"
          >
            Name
          </label>
          <input
            id="conn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Finance invoices"
            className={field}
          />
        </div>
        {spec.config.map((f) => renderField(f, config, setConfig, false))}
      </div>

      <fieldset className="mt-5 rounded-xl border border-[var(--line-1)] p-3">
        <legend className="flex items-center gap-1.5 px-1 text-size-caption font-semibold text-[var(--ink-2)]">
          <KeyRound className="h-3.5 w-3.5" aria-hidden /> Credentials
        </legend>
        <p className="mb-3 text-size-caption text-[var(--ink-3)]">
          Stored in AWS Secrets Manager and never shown again.
          {existing ? " Fill these in only to replace them." : ""}
        </p>
        <div className="space-y-3">
          {spec.secret.map((f) => renderField(f, secret, setSecret, true))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-1 text-size-caption font-semibold text-[var(--ink-2)]">
          Who can use it
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["private", Lock, "Only me", "Nobody else can see it."],
              [
                "org",
                Users,
                "Everyone in my organisation",
                "Others can browse it and use it in their automations. They never see the credentials and cannot change it.",
              ],
            ] as const
          ).map(([value, Icon, label, hint]) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer gap-2 rounded-xl border p-3",
                visibility === value
                  ? "border-[var(--brand-a)] bg-[var(--surface-2)]"
                  : "border-[var(--line-1)]",
              )}
            >
              <input
                type="radio"
                name="conn-visibility"
                value={value}
                checked={visibility === value}
                onChange={() => setVisibility(value)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1.5 text-size-ui font-medium text-[var(--ink-1)]">
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                </span>
                <span className="mt-0.5 block text-size-caption text-[var(--ink-3)]">
                  {hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]"
        >
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-2">
        <button type="submit" disabled={busy} className={btn.primary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{" "}
          {existing ? "Save changes" : "Save and test"}
        </button>
        <button type="button" onClick={onCancel} className={btn.ghost}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Browse ────────────────────────────────────────────────────────────────────

function Browser({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/connections/${connection.id}/browse?path=${encodeURIComponent(path)}`,
      );
      const data = await readJson<{ items?: Item[]; truncated?: boolean }>(res);
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? `Could not list files (${res.status})`);
        setItems([]);
      } else {
        setItems(data.items ?? []);
        setTruncated(!!data.truncated);
      }
    })().catch(() => !cancelled && setError("Could not reach the server"));
    return () => {
      cancelled = true;
    };
  }, [connection.id, path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (p: string) => {
    setItems(null);
    setError(null);
    setPath(p);
  };
  const crumbs = path ? path.split("/") : [];

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={`Files in ${connection.name}`}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-[var(--line-1)] bg-[var(--surface-1)] shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-[var(--line-1)] px-4 py-3">
          <FolderOpen className="h-4 w-4 text-[var(--ink-3)]" aria-hidden />
          <p className="flex-1 truncate text-size-body font-semibold text-[var(--ink-1)]">
            {connection.name}
          </p>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={btn.icon}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav
          aria-label="Folder"
          className="flex flex-wrap items-center gap-1 border-b border-[var(--line-1)] px-4 py-2 text-size-caption"
        >
          <button
            type="button"
            onClick={() => go("")}
            className="font-medium text-[var(--brand-a)] hover:underline"
          >
            {connection.config.rootFolder || "Root"}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <ChevronRight
                className="h-3 w-3 text-[var(--ink-3)]"
                aria-hidden
              />
              <button
                type="button"
                onClick={() => go(crumbs.slice(0, i + 1).join("/"))}
                className="text-[var(--ink-2)] hover:underline"
              >
                {c}
              </button>
            </span>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p className="m-4 rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">
              {error}
            </p>
          )}
          {!items && !error && (
            <p className="flex items-center gap-2 p-4 text-size-ui text-[var(--ink-3)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {items && items.length === 0 && !error && (
            <p className="p-4 text-size-ui text-[var(--ink-3)]">
              This folder is empty.
            </p>
          )}
          <ul className="divide-y divide-[var(--line-1)]">
            {items?.map((it) => (
              <li key={it.path}>
                {it.isFolder ? (
                  <button
                    type="button"
                    onClick={() => go(it.path)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-[var(--surface-2)]"
                  >
                    <FolderClosed
                      className="h-4 w-4 text-[var(--brand-a)]"
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-size-ui text-[var(--ink-1)]">
                      {it.name}
                    </span>
                    <ChevronRight
                      className="h-4 w-4 text-[var(--ink-3)]"
                      aria-hidden
                    />
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2">
                    <File className="h-4 w-4 text-[var(--ink-3)]" aria-hidden />
                    <span className="flex-1 truncate text-size-ui text-[var(--ink-1)]">
                      {it.name}
                    </span>
                    <span className="text-size-caption tabular-nums text-[var(--ink-3)]">
                      {size(it.size)}
                    </span>
                    <span className="hidden w-28 text-right text-size-caption text-[var(--ink-3)] sm:inline">
                      {it.modified
                        ? new Date(it.modified).toLocaleDateString()
                        : ""}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {truncated && (
            <p className="px-4 py-3 text-size-caption text-[var(--ink-3)]">
              Showing the first 100 items.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function ConnectionRow({
  c,
  testing,
  onTest,
  onBrowse,
  onEdit,
  onDelete,
}: {
  c: Connection;
  testing: boolean;
  onTest: () => void;
  onBrowse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = KIND[c.kind]?.Icon ?? Cloud;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--ink-2)]">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate text-size-ui font-semibold text-[var(--ink-1)]">
            {c.name}
          </span>
          <span className="text-size-caption text-[var(--ink-3)]">
            {KIND[c.kind]?.label}
          </span>
        </p>
        <p className="truncate font-mono text-size-caption text-[var(--ink-3)]">
          {where(c)}
        </p>
        {c.status === "error" && c.lastError && (
          <p className="mt-0.5 line-clamp-2 text-size-caption text-[var(--bad)]">
            {c.lastError}
          </p>
        )}
      </div>
      <SharingChip c={c} />
      <StatusChip c={c} />
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className={btn.ghost}
          aria-label={`Test ${c.name}`}
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}{" "}
          Test
        </button>
        <button
          type="button"
          onClick={onBrowse}
          className={btn.ghost}
          aria-label={`Browse ${c.name}`}
        >
          <FolderOpen className="h-4 w-4" /> Browse
        </button>
        {c.canManage !== false && (
          <>
            <button
              type="button"
              onClick={onEdit}
              className={btn.icon}
              aria-label={`Edit ${c.name}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className={btn.icon}
              aria-label={`Delete ${c.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<{ existing: Connection | null } | null>(
    null,
  );
  const [browsing, setBrowsing] = useState<Connection | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "ok" | "bad";
    text: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/connections");
      const data = await readJson<{ connections?: Connection[] }>(res);
      if (cancelled) return;
      if (!res.ok)
        setLoadError(
          data.error ?? `Could not load connections (${res.status})`,
        );
      else setConnections(data.connections ?? []);
    })().catch(() => !cancelled && setLoadError("Could not reach the server"));
    return () => {
      cancelled = true;
    };
  }, []);

  const replace = (c: Connection) =>
    setConnections((list) =>
      (list ?? []).some((x) => x.id === c.id)
        ? list!.map((x) => (x.id === c.id ? c : x))
        : [...(list ?? []), c].sort((a, b) => a.name.localeCompare(b.name)),
    );

  const test = async (c: Connection) => {
    setTesting(c.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/connections/${c.id}/test`, {
        method: "POST",
      });
      const data = await readJson<{
        connection?: Connection;
        ok?: boolean;
        detail?: string;
      }>(res);
      if (data.connection) replace(data.connection);
      setNotice(
        res.ok && data.ok
          ? { tone: "ok", text: `${c.name}: ${data.detail}` }
          : {
              tone: "bad",
              text: `${c.name}: ${data.detail ?? data.error ?? "test failed"}`,
            },
      );
    } catch {
      setNotice({ tone: "bad", text: "Could not reach the server" });
    } finally {
      setTesting(null);
    }
  };

  const remove = async (c: Connection) => {
    if (
      typeof window.confirm === "function" &&
      !window.confirm(
        `Delete "${c.name}"?${c.visibility === "org" ? " It is shared: automations of other people that use it will stop working." : ""} Its credentials are scheduled for deletion in AWS Secrets Manager (recoverable for 7 days).`,
      )
    )
      return;
    const res = await fetch(`/api/connections/${c.id}`, { method: "DELETE" });
    if (res.ok) {
      setConnections((list) => (list ?? []).filter((x) => x.id !== c.id));
      setNotice({ tone: "ok", text: `Deleted ${c.name}.` });
    } else
      setNotice({
        tone: "bad",
        text: (await readJson(res)).error ?? "Could not delete",
      });
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-size-kpi-lg font-semibold tracking-tight text-[var(--ink-1)]">
            Connections
          </h1>
          <p className="mt-1 max-w-2xl text-size-body text-[var(--ink-3)]">
            Connect file storage so your automations can read documents. A
            connection is private to you until you share it. Credentials are
            kept in AWS Secrets Manager, never in the database.
          </p>
        </div>
        {!form && (
          <button
            type="button"
            onClick={() => setForm({ existing: null })}
            className={btn.primary}
          >
            <Plus className="h-4 w-4" /> Add connection
          </button>
        )}
      </div>

      {notice && (
        <div
          role="status"
          className={cn(
            "mt-4 flex items-start gap-2 rounded-xl px-3 py-2 text-size-ui",
            notice.tone === "ok"
              ? "bg-[var(--ok-bg)] text-[var(--ok)]"
              : "bg-[var(--bad-bg)] text-[var(--bad)]",
          )}
        >
          <span className="flex-1 break-words">{notice.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {form && (
        <section
          aria-label="Connection form"
          className="mt-6 rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm"
        >
          <ConnectionForm
            existing={form.existing}
            onCancel={() => setForm(null)}
            onDone={(c) => {
              replace(c);
              setForm(null);
              setNotice({ tone: "ok", text: `Saved ${c.name}. Testing it…` });
              void test(c);
            }}
          />
        </section>
      )}

      {loadError && (
        <p className="mt-6 rounded-xl bg-[var(--bad-bg)] px-3 py-2 text-size-ui text-[var(--bad)]">
          {loadError}
        </p>
      )}
      {!connections && !loadError && (
        <div className="mt-6 space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]"
            />
          ))}
        </div>
      )}
      {connections && connections.length === 0 && !form && (
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--line-2)] px-6 py-12 text-center">
          <p className="text-size-body font-medium text-[var(--ink-1)]">
            No connections yet
          </p>
          <p className="mx-auto mt-1 max-w-md text-size-ui text-[var(--ink-3)]">
            Add an Amazon S3 bucket, an Azure Blob container or a SharePoint
            site. Connections colleagues share with the organisation show up
            here too.
          </p>
        </div>
      )}

      {connections && connections.length > 0 && (
        <>
          {(
            [
              ["Your connections", connections.filter((c) => c.mine !== false)],
              ["Shared with you", connections.filter((c) => c.mine === false)],
            ] as const
          )
            .filter(([, list]) => list.length > 0)
            .map(([title, list]) => (
              <section key={title} className="mt-6">
                <h2 className="mb-2 text-size-caption font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                  {title}
                </h2>
                <ul
                  aria-label={title}
                  className="divide-y divide-[var(--line-1)] overflow-hidden rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)]"
                >
                  {list.map((c) => (
                    <ConnectionRow
                      key={c.id}
                      c={c}
                      testing={testing === c.id}
                      onTest={() => void test(c)}
                      onBrowse={() => setBrowsing(c)}
                      onEdit={() => setForm({ existing: c })}
                      onDelete={() => void remove(c)}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </>
      )}

      {browsing && (
        <Browser connection={browsing} onClose={() => setBrowsing(null)} />
      )}
    </div>
  );
}
