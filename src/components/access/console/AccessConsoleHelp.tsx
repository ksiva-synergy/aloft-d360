'use client';

import { useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import userStyles from '@/components/users/users.module.css';
import s from './console.module.css';

export type AccessHelpTab = 'data' | 'departments' | 'protections' | 'people' | 'log';

const HELP: Record<
  AccessHelpTab,
  { title: string; body: ReactNode }
> = {
  departments: {
    title: 'Departments',
    body: (
      <ol className="m-0 list-decimal space-y-2 pl-4 text-caption leading-relaxed text-muted-foreground">
        <li>
          A <strong className="text-foreground">department</strong> (Marine, QHSE) owns catalogs, schemas, or tables. Add data from the tree; a schema covers every table inside it. A table can belong to several departments.
        </li>
        <li>
          This tab is only about <strong className="text-foreground">data</strong>. Who may use a department&apos;s data is set on <strong className="text-foreground">People &amp; groups</strong>: open a group and add the departments it can use, with <strong className="text-foreground">Use</strong> or <strong className="text-foreground">Use + export</strong>.
        </li>
        <li>A person in several groups gets the data of all their groups&apos; departments. A Block, or a protection, still applies.</li>
      </ol>
    ),
  },
  data: {
    title: 'Data tab',
    body: (
      <ol className="m-0 list-decimal space-y-2 pl-4 text-caption leading-relaxed text-muted-foreground">
        <li>
          Pick a catalog, schema, or table in <strong className="text-foreground">Browse</strong> — summary shows Use, whole-path protection, and columns.
        </li>
        <li>
          <strong className="text-foreground">Give access</strong> = Use rules; <strong className="text-foreground">Protections tab</strong> = who sees protected column values.
        </li>
        <li>
          Table search uses <strong className="text-foreground">name and embeddings</strong> together in one search.
        </li>
        <li>
          On a table, <strong className="text-foreground">ⓘ</strong> on each column — harvest detail and sample values (admins).
        </li>
      </ol>
    ),
  },
  protections: {
    title: 'Protections tab',
    body: (
      <ol className="m-0 list-decimal space-y-2 pl-4 text-caption leading-relaxed text-muted-foreground">
        <li>Pick a protection; <strong className="text-foreground">Add columns</strong> searches name + embeddings; <strong className="text-foreground">Give access</strong> for real values.</li>
        <li>
          <strong className="text-foreground">Who can see · give access</strong> — who gets real values for this protection.
        </li>
        <li>Whole catalog/schema/table protect lives on the <strong className="text-foreground">Data</strong> tab when needed.</li>
      </ol>
    ),
  },
  people: {
    title: 'People & groups',
    body: (
      <p className="text-caption leading-relaxed text-muted-foreground">
        Groups hold people for protections and requests. Look up someone to see what they can use, what protects them, and which groups they belong to.
      </p>
    ),
  },
  log: {
    title: 'Requests & log',
    body: (
      <p className="text-caption leading-relaxed text-muted-foreground">
        Approve or reject access requests, browse history, and (for admins) column-check health. Denied queries from the last 7 days appear in the tab badge when non-zero.
      </p>
    ),
  },
};

/** Top-right of the tab bar: opens help for the active Data access tab. */
export function AccessConsoleHelpButton({
  tab,
  onGoProtections,
}: {
  tab: AccessHelpTab;
  onGoProtections?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { title, body } = HELP[tab];
  return (
    <>
      <button
        type="button"
        className={cn(s.navHelpBtn, 'shrink-0')}
        onClick={() => setOpen(true)}
        aria-label={`How the ${title} works`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">How it works</span>
      </button>
      <Dialog open={open} onOpenChange={(v) => (!v ? setOpen(false) : undefined)}>
        <DialogContent className={cn(userStyles.surface, 'max-w-lg overflow-x-hidden')}>
          <div role="dialog" aria-modal="true" aria-label={title}>
            <div className="mb-3 flex items-start gap-2">
              <h2 className="flex-1 text-title-card">{title}</h2>
              <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {body}
            {tab === 'data' && onGoProtections ? (
              <p className="mt-3 text-caption">
                <button type="button" className={cn(s.linkBtn, 'font-medium')} onClick={() => { setOpen(false); onGoProtections(); }}>
                  Open Protections tab
                </button>
              </p>
            ) : null}
            {tab === 'protections' ? (
              <p className="mt-3 text-caption text-muted-foreground">
                Reference: <code className="text-[11px]">docs/access/feature-map.md</code>
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
