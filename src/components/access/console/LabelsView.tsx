'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { SENSITIVITY_LABEL, accessFetch, runAsync, send, type Sensitivity, type TreeNode } from './api';
import { EstateTree, type TreeContext } from './EstateTree';
import { Card, LabelChip, Mono, Segmented, type SegOption } from './parts';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

type LabelRow = { id: string; path: string; label: 'confidential' | 'restricted'; reason: string | null; updatedAt: string };
type Pending = { path: string; to: Sensitivity; tables: number | null; from: Sensitivity };

const RANK: Record<Sensitivity, number> = { internal: 0, confidential: 1, restricted: 2 };

export function LabelsView({
  isPlatformAdmin,
  onChanged,
}: {
  isPlatformAdmin: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [labels, setLabels] = useState<LabelRow[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const readOnly = useConsoleReadOnly();

  const load = useCallback(async () => {
    const data = await accessFetch<{ labels: LabelRow[] }>('/api/access/labels');
    setLabels(data.labels);
  }, []);

  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load labels')));
  }, [load]);

  async function save(ctx?: TreeContext) {
    if (!pending || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.to === 'internal') {
        await send('/api/access/labels', 'DELETE', { path: pending.path, reason: reason.trim() });
      } else {
        await send('/api/access/labels', 'POST', { path: pending.path, label: pending.to, reason: reason.trim() });
      }
      setPending(null);
      setReason('');
      await Promise.all([load(), ctx ? ctx.reload() : Promise.resolve(), onChanged()]);
      if (!ctx) setTreeKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the label');
    } finally {
      setBusy(false);
    }
  }

  function start(node: { path: string; tableCount: number | null; depth: number }, to: Sensitivity, from: Sensitivity) {
    setPending({ path: node.path, to, from, tables: node.depth === 3 ? 1 : node.tableCount });
    setReason('');
  }

  const pendingForm = (ctx?: TreeContext) =>
    pending ? (
      <div className={cn(s.inlineForm, 'col-span-full')}>
        <p className="text-size-ui">
          {pending.to === 'internal' ? 'Remove the label from' : `Label as ${SENSITIVITY_LABEL[pending.to]}:`}{' '}
          <Mono>{pending.path}</Mono>
          {pending.tables !== null ? (
            <span className="text-muted-foreground">
              {' '}
              · applies to {pending.tables} table{pending.tables === 1 ? '' : 's'}
            </span>
          ) : null}
        </p>
        {RANK[pending.to] > RANK[pending.from] ? (
          <p className="text-caption text-muted-foreground">
            People without {SENSITIVITY_LABEL[pending.to]} clearance will stop seeing these tables, including their
            names, once enforcement is on.
          </p>
        ) : null}
        <Input
          className={userStyles.input}
          value={reason}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required), e.g. crew medical records"
          aria-label="Reason for this label change"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save(ctx);
            if (e.key === 'Escape') setPending(null);
          }}
        />
        <div className={s.rowActions}>
          <Button type="button" className={userStyles.primary} disabled={busy || !reason.trim()} onClick={() => void save(ctx)}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="outline" className={userStyles.secondaryButton} onClick={() => setPending(null)}>
            Cancel
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <div className="p-5">
      {error ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}

      <Card
        title={`Labelled paths${labels ? ` (${labels.length})` : ''}`}
        hint="Unlabelled data is Internal. A label on a catalog or schema covers everything inside it. A label never gives anyone access; it only limits who can use what they were already granted."
      >
        {labels === null ? (
          <p className="text-caption text-muted-foreground">Loading…</p>
        ) : labels.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            Nothing is labelled yet. Find sensitive tables in the tree below and mark them Confidential or Restricted.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {labels.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <LabelChip label={l.label} />
                <Mono>{l.path}</Mono>
                <span className="text-caption text-muted-foreground">{l.reason ?? 'no reason recorded'}</span>
                {readOnly ? null : isPlatformAdmin ? (
                  <button
                    type="button"
                    className={cn(s.linkBtn, 'ml-auto')}
                    onClick={() => start({ path: l.path, tableCount: null, depth: l.path.split('.').length }, 'internal', l.label)}
                  >
                    Remove
                  </button>
                ) : (
                  <span className="ml-auto text-caption text-muted-foreground" title="Removing a label opens data">
                    Platform admin can remove
                  </span>
                )}
                {pending?.path === l.path && pending.to === 'internal' ? <div className="w-full">{pendingForm()}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        className="mt-[14px]"
        title="Classify the estate"
        hint="Set a label on a catalog, schema, or table. Labels inherit downward and can only go up: a table inside a Confidential schema is at least Confidential."
      >
        <EstateTree
          rightTitle="Label"
          refreshKey={treeKey}
          renderRight={(node: TreeNode) => {
            const own: Sensitivity = node.label.own ?? 'internal';
            const inherited: Sensitivity = node.label.own ? 'internal' : node.label.label;
            const floor: Sensitivity = node.label.from && node.label.from !== node.path ? node.label.label : 'internal';
            const options: SegOption<Sensitivity>[] = (['internal', 'confidential', 'restricted'] as Sensitivity[]).map(
              (v) => ({
                value: v,
                label: SENSITIVITY_LABEL[v],
                tone: v === 'restricted' ? 'danger' : v === 'confidential' ? 'warn' : undefined,
                disabled: (RANK[v] < RANK[floor] && v !== own) || (!isPlatformAdmin && RANK[v] < RANK[own]),
                title:
                  RANK[v] < RANK[floor]
                    ? `A parent is ${SENSITIVITY_LABEL[floor]}; labels can only go up`
                    : !isPlatformAdmin && RANK[v] < RANK[own]
                      ? 'Only a platform admin can lower a label'
                      : undefined,
              }),
            );
            return (
              <>
                {!node.label.own && node.label.from ? (
                  <span className="text-caption text-muted-foreground">from {node.label.from}</span>
                ) : null}
                <Segmented<Sensitivity>
                  ariaLabel={`Label for ${node.path}`}
                  options={options}
                  value={node.label.own ? own : inherited === 'internal' ? 'internal' : null}
                  inherited={inherited !== 'internal' ? inherited : null}
                  disabled={busy || readOnly}
                  onChange={(v) => start(node, v, node.label.label)}
                />
              </>
            );
          }}
          renderBelow={(node, ctx) => (pending?.path === node.path ? pendingForm(ctx) : null)}
        />
      </Card>
    </div>
  );
}

