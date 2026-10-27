'use client';

import { useEffect, useState } from 'react';

interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    fetch('/api/audit-log')
      .then((r) => r.json())
      .then((d) => setEntries(d.items || []))
      .catch(() => {});
  }, []);

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="type-title-page">Audit Log</h1>
        <p className="text-size-body text-muted-foreground mt-0.5">All lifecycle actions · Immutable trail</p>
      </div>

      <div className="border rounded-lg dark:border-[var(--line-1)] bg-[color:var(--surface-1)] dark:bg-[var(--background)] overflow-hidden">
        <table className="w-full text-size-body">
          <thead>
            <tr className="border-b dark:border-[var(--line-1)] bg-[color:var(--surface-2)] dark:bg-[var(--background)]">
              <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Timestamp</th>
              <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Actor</th>
              <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Action</th>
              <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Target</th>
              <th className="text-left px-4 py-2.5 text-size-ui uppercase tracking-wide text-muted-foreground font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-b last:border-b-0 dark:border-[var(--line-1)] hover:bg-[color:var(--surface-2)] dark:hover:bg-[var(--surface-2)]">
                <td className="px-4 py-3 font-mono text-size-ui text-muted-foreground">{e.ts}</td>
                <td className="px-4 py-3 font-mono text-size-ui">{e.actor}</td>
                <td className="px-4 py-3">
                  <span className="text-size-ui px-2 py-0.5 rounded-full bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] text-[color:var(--ink-2)] dark:text-[color:var(--ink-3)] border border-[color:var(--line-1)] dark:border-[color:var(--line-1)] font-medium">
                    {e.action}
                  </span>
                </td>
                <td className="px-4 py-3">{e.target}</td>
                <td className="px-4 py-3 text-muted-foreground text-size-ui">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
