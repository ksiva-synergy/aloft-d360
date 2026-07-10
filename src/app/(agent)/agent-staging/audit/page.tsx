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
        <h1 className="text-lg font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-0.5">All lifecycle actions · Immutable trail</p>
      </div>

      <div className="border rounded-lg dark:border-[#2d333b] bg-white dark:bg-[#0f131a] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b dark:border-[#2d333b] bg-slate-50 dark:bg-[#0f131a]">
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Timestamp</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Actor</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Action</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Target</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-b last:border-b-0 dark:border-[#2d333b] hover:bg-slate-50 dark:hover:bg-[#1c2128]">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{e.ts}</td>
                <td className="px-4 py-3 font-mono text-xs">{e.actor}</td>
                <td className="px-4 py-3">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 font-medium">
                    {e.action}
                  </span>
                </td>
                <td className="px-4 py-3">{e.target}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
