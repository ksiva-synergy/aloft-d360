'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Building2, Pencil, Plus, ShieldAlert, User, Users, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { budgetView, buildBudgetScope, fmtUsd, parseBudgetScope, periodWindow } from '@/lib/spend/cost-derive';
import type { BudgetMode, BudgetPeriod, BudgetPolicy, BudgetStatus } from '@/lib/spend/cost-types';
import { Card, EmptyState, HealthBadge, Pill, Segmented } from './ui';
import styles from './cost.module.css';

export const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'readonly', label: 'Read only' },
  { value: 'admin', label: 'Admin' },
  { value: 'platform_admin', label: 'Platform admin' },
];

export interface DirectoryUser {
  id: string;
  name: string | null;
  email: string | null;
}

export interface BudgetsState {
  policies: BudgetPolicy[];
  statuses: BudgetStatus[];
}

export interface BudgetDraft {
  id?: string;
  scope: string;
  amountUsd: number;
  period: BudgetPeriod;
  mode: BudgetMode;
  alertPct: number;
  alertEmail?: string | null;
}

export async function saveBudget(draft: BudgetDraft): Promise<BudgetsState> {
  const r = await fetch('/api/admin/cost/budgets', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  const data = (await r.json().catch(() => ({}))) as Partial<BudgetsState> & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `Save failed (${r.status})`);
  return { policies: data.policies ?? [], statuses: data.statuses ?? [] };
}

function roleLabel(role: string): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}

export function policyTitle(p: { scope: string }, userName: (id: string) => string | null): string {
  const s = parseBudgetScope(p.scope);
  if (s.kind === 'org') return s.bucket === 'harvest' ? 'Harvest & platform jobs' : 'Interactive AI';
  if (s.kind === 'role') return `${roleLabel(s.subject ?? '')} role`;
  if (s.kind === 'role-total') return `${roleLabel(s.subject ?? '')} role · combined`;
  if (s.kind === 'user') return userName(s.subject ?? '') ?? `User ${s.subject?.slice(0, 8)}`;
  return p.scope;
}

const daysLeftFmt = (end: Date) => {
  const d = Math.ceil((end.getTime() - Date.now()) / 86400000);
  return d <= 1 ? 'resets within a day' : `resets in ${d} days`;
};

export function BudgetsPanel({
  state,
  onChange,
  userName,
  createFor,
  readOnly = false,
}: {
  state: BudgetsState | null;
  onChange: (s: BudgetsState) => void;
  userName: (id: string) => string | null;
  /** Opens the create form preset to a user (from the People drawer). A new object each request. */
  createFor?: { userId: string } | null;
  /** View (not Manage) on Govern → Cost monitor: no Add cap, no edit. The API refuses changes either way. */
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(!!createFor);
  const [presetUser, setPresetUser] = useState<string | null>(createFor?.userId ?? null);
  const [seenRequest, setSeenRequest] = useState(createFor ?? null);
  if (createFor && createFor !== seenRequest) {
    setSeenRequest(createFor);
    setPresetUser(createFor.userId);
    setCreating(true);
  }

  const statusByScope = useMemo(() => new Map((state?.statuses ?? []).map((s) => [s.scope, s])), [state]);

  if (!state) {
    return (
      <Card>
        <EmptyState icon={<Wallet className="h-5 w-5" />} title="Loading budget policies…" />
      </Card>
    );
  }

  const groups: { id: string; title: string; hint: string; icon: ReactNode; rows: BudgetPolicy[] }[] = [
    {
      id: 'org',
      title: 'Organization budgets',
      hint: 'Total spend for the whole workspace, per bucket.',
      icon: <Building2 className="h-4 w-4" />,
      rows: state.policies.filter((p) => parseBudgetScope(p.scope).kind === 'org'),
    },
    {
      id: 'role',
      title: 'Role defaults',
      hint: 'Per-person caps for everyone with a role (unless they have an override), and optional combined caps on the role as a whole.',
      icon: <Users className="h-4 w-4" />,
      // Each role's per-person cap, then its combined cap.
      rows: state.policies
        .filter((p) => {
          const k = parseBudgetScope(p.scope).kind;
          return k === 'role' || k === 'role-total';
        })
        .sort((a, b) => {
          const pa = parseBudgetScope(a.scope);
          const pb = parseBudgetScope(b.scope);
          return (pa.subject ?? '').localeCompare(pb.subject ?? '') || (pa.kind === 'role' ? -1 : 1) - (pb.kind === 'role' ? -1 : 1);
        }),
    },
    {
      id: 'user',
      title: 'People overrides',
      hint: 'A personal interactive AI cap. Takes precedence over the role default.',
      icon: <User className="h-4 w-4" />,
      rows: state.policies.filter((p) => parseBudgetScope(p.scope).kind === 'user'),
    },
  ];
  const other = state.policies.filter((p) => parseBudgetScope(p.scope).kind === 'other');
  if (other.length) groups.push({ id: 'other', title: 'Other policies', hint: 'Legacy scopes.', icon: <Wallet className="h-4 w-4" />, rows: other });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--line-1)] bg-[var(--surface-1)] px-5 py-4">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]">
            <ShieldAlert className="h-4 w-4" aria-hidden />
          </span>
          <div className="text-size-ui text-[var(--ink-2)]">
            <p>
              <span className="font-medium text-[var(--ink-1)]">Soft</span> budgets only flag spend.{' '}
              <span className="font-medium text-[var(--ink-1)]">Hard</span> budgets block new interactive turns or harvest launches once the projected
              spend would pass the cap.
            </p>
            <p className="mt-0.5 text-caption text-[var(--ink-3)]">Periods run in UTC. Monthly budgets reset on the 1st.</p>
          </div>
        </div>
        {!creating && !readOnly ? (
          <button
            type="button"
            onClick={() => {
              setPresetUser(null);
              setCreating(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--brand-a)] px-3 py-1.5 text-size-ui font-medium text-[var(--on-brand)] hover:bg-[color-mix(in_srgb,var(--brand-a)_86%,black)]"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add cap
          </button>
        ) : null}
      </div>

      {creating && !readOnly ? (
        <Card>
          <div className="px-5 pt-4">
            <h2 className="text-title-card">New interactive AI cap</h2>
            <p className="mt-0.5 text-caption text-[var(--ink-3)]">
              Set a personal cap for one person, a per-person default for a role, or a combined cap on everyone with a role.
            </p>
          </div>
          <BudgetForm
            key={presetUser ?? 'new'}
            mode="create"
            existingScopes={new Set(state.policies.map((p) => p.scope))}
            presetUserId={presetUser}
            initial={{ scope: presetUser ? buildBudgetScope('user', presetUser) : '', amountUsd: 50, period: 'monthly', mode: 'soft', alertPct: 80 }}
            onCancel={() => setCreating(false)}
            onSaved={(s) => {
              onChange(s);
              setCreating(false);
            }}
          />
        </Card>
      ) : null}

      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`budget-group-${g.id}`}>
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="text-[var(--ink-3)]">{g.icon}</span>
            <h2 id={`budget-group-${g.id}`} className="text-size-ui font-semibold text-[var(--ink-1)]">{g.title}</h2>
            <span className="text-caption text-[var(--ink-3)]">· {g.hint}</span>
          </div>
          {g.rows.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--line-2)] px-5 py-6 text-center text-caption text-[var(--ink-3)]">
              {g.id === 'user' ? (readOnly ? 'No personal overrides yet.' : 'No personal overrides yet. Use “Add cap” or open someone from the People tab.') : 'No policies in this group.'}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {g.rows.map((p) => (
                <BudgetCard
                  key={p.id}
                  policy={p}
                  status={statusByScope.get(p.scope)}
                  title={policyTitle(p, userName)}
                  userName={userName}
                  editing={!readOnly && editing === p.id}
                  onEdit={readOnly ? undefined : () => setEditing(editing === p.id ? null : p.id)}
                  onSaved={(s) => {
                    onChange(s);
                    setEditing(null);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function BudgetMeter({
  spent,
  cap,
  alertPct,
  projected,
  label = 'Budget used',
}: {
  spent: number;
  cap: number;
  alertPct: number;
  projected: number | null;
  label?: string;
}) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const over = cap > 0 && spent >= cap;
  const warn = cap > 0 && (spent / cap) * 100 >= alertPct;
  const projPct = projected != null && cap > 0 ? Math.min(100, (projected / cap) * 100) : null;
  return (
    <div className="relative pt-1" role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={spent} aria-label={label}>
      <div className="h-2.5 overflow-hidden rounded-full bg-[var(--cost-track)]">
        <div
          className={cn(styles.meterFill, 'h-full rounded-full')}
          style={{ width: `${pct}%`, background: over ? 'var(--bad)' : warn ? 'var(--warn)' : 'var(--brand-a)' }}
        />
      </div>
      {/* Alert threshold tick */}
      <span
        aria-hidden
        className="absolute top-0 h-[18px] w-[2px] rounded-full bg-[var(--ink-3)]"
        style={{ left: `calc(${Math.min(alertPct, 100)}% - 1px)` }}
        title={`Alert at ${alertPct}%`}
      />
      {/* Projected end-of-period marker */}
      {projPct != null && projPct > pct + 1 ? (
        <span
          aria-hidden
          className="absolute top-1 h-2.5 rounded-r-full border-2 border-l-0 border-dashed border-[var(--ink-3)] opacity-60"
          style={{ left: `${pct}%`, width: `${projPct - pct}%` }}
        />
      ) : null}
    </div>
  );
}

function BudgetCard({
  policy,
  status,
  title,
  userName,
  editing,
  onEdit,
  onSaved,
}: {
  policy: BudgetPolicy;
  status?: BudgetStatus;
  title: string;
  userName: (id: string) => string | null;
  editing: boolean;
  /** Absent when the viewer cannot change budgets. */
  onEdit?: () => void;
  onSaved: (s: BudgetsState) => void;
}) {
  const scope = parseBudgetScope(policy.scope);
  const view = budgetView(policy, status);
  const { spentUsd: spent, projectedUsd: projected, health, group } = view;
  const perUser = view.kind === 'role';
  const topName = group?.topUserId ? (userName(group.topUserId) ?? `User ${group.topUserId.slice(0, 8)}`) : null;
  const { end } = periodWindow(policy.period);
  const per = policy.period === 'daily' ? 'day' : 'month';

  return (
    <article
      className={cn(
        styles.card,
        'flex flex-col p-4',
        health === 'exceeded' && 'border-[color:var(--bad)]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-size-ui font-semibold text-[var(--ink-1)]">{title}</h3>
            <Pill tone={policy.mode === 'hard' ? 'brand' : 'neutral'}>{policy.mode === 'hard' ? 'Hard · blocks' : 'Soft · flags'}</Pill>
          </div>
          <p className="mt-0.5 text-caption capitalize text-[var(--ink-3)]">
            {scope.bucket === 'harvest' ? 'Harvest' : 'Interactive AI'} · {policy.period}
            {view.kind === 'role-total' ? <span className="normal-case"> · everyone with the role together</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HealthBadge health={health} />
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              aria-expanded={editing}
              aria-label={`Edit ${title}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {perUser ? (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <p className="text-size-ui text-[var(--ink-2)]">
              <span className="text-kpi-sm tabular-nums text-[var(--ink-1)]">{fmtUsd(spent)}</span>
              <span className="ml-1">combined this {per}</span>
            </p>
            <span className="text-size-ui tabular-nums text-[var(--ink-2)]">
              {group ? (group.people === 1 ? '1 person' : `${group.people} people`) : '—'}
            </span>
          </div>
          <p className="mt-0.5 text-caption text-[var(--ink-3)]">
            Cap is {fmtUsd(policy.amountUsd)} per person per {per}
            {projected != null && spent > 0 ? (
              <>
                {' '}· combined on pace for <span className="font-medium tabular-nums text-[var(--ink-2)]">{fmtUsd(projected)}</span>
              </>
            ) : null}
          </p>
          {group && group.people > 0 && topName ? (
            <>
              <div className="mt-3 flex items-baseline justify-between gap-3 text-caption">
                <span className="min-w-0 truncate text-[var(--ink-2)]">
                  Highest: <span className="font-medium text-[var(--ink-1)]">{topName}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[var(--ink-2)]">
                  {fmtUsd(group.topUserUsd)} of {fmtUsd(policy.amountUsd)}
                  {policy.amountUsd > 0 ? ` · ${view.pctUsed.toFixed(0)}%` : ''}
                </span>
              </div>
              <div className="mt-1.5">
                <BudgetMeter spent={group.topUserUsd} cap={policy.amountUsd} alertPct={policy.alertPct} projected={null} label={`Highest person's share of the ${title} cap`} />
              </div>
            </>
          ) : (
            <p className="mt-3 text-caption text-[var(--ink-3)]">{group ? `No spend under this cap yet this ${per}.` : 'Per-person breakdown unavailable.'}</p>
          )}
          <p className="mt-2 text-caption text-[var(--ink-3)]">
            {group && group.overCount > 0 ? (
              <span className="font-medium text-[var(--bad)]">{group.overCount} over cap · </span>
            ) : null}
            {group && group.alertCount > 0 ? (
              <span className="font-medium text-[var(--warn)]">{group.alertCount} past alert · </span>
            ) : null}
            Alerts at {policy.alertPct}% · {daysLeftFmt(end)} · people with an override are counted there
          </p>
        </>
      ) : (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <p className="text-size-ui text-[var(--ink-2)]">
              <span className="text-kpi-sm tabular-nums text-[var(--ink-1)]">{fmtUsd(spent)}</span>
              <span className="ml-1">of {fmtUsd(policy.amountUsd)}</span>
            </p>
            <span className="text-size-ui font-medium tabular-nums text-[var(--ink-2)]">
              {policy.amountUsd > 0 ? `${((spent / policy.amountUsd) * 100).toFixed(0)}%` : '—'}
            </span>
          </div>
          <div className="mt-2">
            <BudgetMeter spent={spent} cap={policy.amountUsd} alertPct={policy.alertPct} projected={projected} />
          </div>
          <p className="mt-2 text-caption text-[var(--ink-3)]">
            {projected != null ? (
              <>
                On pace for <span className="font-medium tabular-nums text-[var(--ink-2)]">{fmtUsd(projected)}</span> ·{' '}
              </>
            ) : null}
            Alerts at {policy.alertPct}% · {daysLeftFmt(end)}
          </p>
          {view.kind === 'role-total' && group ? (
            <p className="mt-1 text-caption text-[var(--ink-3)]">
              {group.people === 1 ? '1 person' : `${group.people} people`} with spend this {per}
              {topName ? (
                <>
                  {' '}· highest <span className="font-medium text-[var(--ink-2)]">{topName}</span>{' '}
                  <span className="tabular-nums">{fmtUsd(group.topUserUsd)}</span>
                </>
              ) : null}
              {' '}· includes people with a personal cap
            </p>
          ) : null}
        </>
      )}

      {editing ? (
        <div className="-mx-4 mt-3 border-t border-[var(--line-1)]">
          <BudgetForm
            mode="edit"
            initial={{ ...policy }}
            spent={perUser ? (group?.topUserUsd ?? undefined) : spent}
            spentWho={perUser ? (topName ?? undefined) : view.kind === 'role-total' ? `Everyone with this role` : undefined}
            onCancel={() => onEdit?.()}
            onSaved={onSaved}
          />
        </div>
      ) : null}
    </article>
  );
}

const inputCls =
  'h-9 w-full rounded-[10px] border border-[var(--line-1)] bg-[var(--surface-1)] px-3 text-size-ui text-[var(--ink-1)] disabled:opacity-60';

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-caption font-medium text-[var(--ink-2)]">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-caption text-[var(--ink-3)]">{hint}</p> : null}
    </div>
  );
}

function BudgetForm({
  mode,
  initial,
  spent,
  spentWho,
  existingScopes,
  presetUserId,
  onCancel,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial: BudgetDraft;
  /** Spend this period that the cap is checked against (role caps: the highest-spending person). */
  spent?: number;
  /** Role caps: who `spent` belongs to. */
  spentWho?: string;
  existingScopes?: Set<string>;
  presetUserId?: string | null;
  onCancel: () => void;
  onSaved: (s: BudgetsState) => void;
}) {
  const [kind, setKind] = useState<'user' | 'role' | 'role-total'>('user');
  const [subject, setSubject] = useState<string>(presetUserId ?? '');
  const [amount, setAmount] = useState(String(initial.amountUsd));
  const [period, setPeriod] = useState<BudgetPeriod>(initial.period);
  const [budgetMode, setBudgetMode] = useState<BudgetMode>(initial.mode);
  const [alertPct, setAlertPct] = useState(String(initial.alertPct));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const idp = mode === 'edit' ? initial.id : 'new';

  useEffect(() => {
    if (mode !== 'create' || kind !== 'user' || users) return;
    let cancelled = false;
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Users ${r.status}`))))
      .then((d: { users?: DirectoryUser[] }) => {
        if (!cancelled) setUsers(d.users ?? []);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, kind, users]);

  const amountNum = Number(amount);
  const alertNum = Number(alertPct);
  const scope = mode === 'edit' ? initial.scope : subject ? buildBudgetScope(kind, subject) : '';
  const duplicate = mode === 'create' && !!scope && !!existingScopes?.has(scope);
  const valid = Number.isFinite(amountNum) && amountNum >= 0 && Number.isInteger(alertNum) && alertNum >= 1 && alertNum <= 100 && !!scope && !duplicate;
  const dirty =
    mode === 'create' ||
    amountNum !== initial.amountUsd ||
    period !== initial.period ||
    budgetMode !== initial.mode ||
    alertNum !== initial.alertPct;
  const blocksNow = budgetMode === 'hard' && spent != null && amountNum > 0 && spent >= amountNum;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const s = await saveBudget({
        id: mode === 'edit' ? initial.id : undefined,
        scope,
        amountUsd: amountNum,
        period,
        mode: budgetMode,
        alertPct: alertNum,
        // Keep whatever is stored; the PUT handler otherwise clears it.
        alertEmail: initial.alertEmail ?? null,
      });
      onSaved(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      {mode === 'create' ? (
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div>
            <span className="mb-1 block text-caption font-medium text-[var(--ink-2)]">Applies to</span>
            <Segmented
              label="Applies to"
              value={kind}
              onChange={(k) => {
                setKind(k);
                setSubject(k === 'user' ? (presetUserId ?? '') : 'member');
              }}
              options={[
                { value: 'user', label: 'One person' },
                { value: 'role', label: 'Each person in a role' },
                { value: 'role-total', label: 'A role combined' },
              ]}
            />
          </div>
          {kind === 'user' ? (
            <Field label="Person" htmlFor={`${idp}-subject`}>
              <select id={`${idp}-subject`} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!users}>
                <option value="">{users ? 'Choose someone…' : 'Loading people…'}</option>
                {(users ?? [])
                  .slice()
                  .sort((a, b) => (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? ''))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ? `${u.name} — ${u.email ?? ''}` : (u.email ?? u.id)}
                    </option>
                  ))}
                {presetUserId && users && !users.some((u) => u.id === presetUserId) ? <option value={presetUserId}>{presetUserId}</option> : null}
              </select>
            </Field>
          ) : (
            <Field
              label="Role"
              htmlFor={`${idp}-subject`}
              hint={
                kind === 'role-total'
                  ? 'One cap shared by everyone with this role, including people with a personal cap.'
                  : 'Applies to each person with this role who has no personal cap.'
              }
            >
              <select id={`${idp}-subject`} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Cap (USD)" htmlFor={`${idp}-amount`}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-size-ui text-[var(--ink-3)]">$</span>
            <input
              id={`${idp}-amount`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className={cn(inputCls, 'pl-6 tabular-nums')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </Field>
        <Field label="Period" htmlFor={`${idp}-period`}>
          <select id={`${idp}-period`} className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}>
            <option value="monthly">Monthly</option>
            <option value="daily">Daily</option>
          </select>
        </Field>
        <Field label="Alert at (% of cap)" htmlFor={`${idp}-alert`}>
          <input
            id={`${idp}-alert`}
            type="number"
            min={1}
            max={100}
            step={1}
            className={cn(inputCls, 'tabular-nums')}
            value={alertPct}
            onChange={(e) => setAlertPct(e.target.value)}
          />
        </Field>
      </div>

      <div>
        <span className="mb-1 block text-caption font-medium text-[var(--ink-2)]">Enforcement</span>
        <Segmented
          label="Enforcement"
          value={budgetMode}
          onChange={setBudgetMode}
          options={[
            { value: 'soft', label: 'Soft — flag only' },
            { value: 'hard', label: 'Hard — block' },
          ]}
        />
      </div>

      {blocksNow ? (
        <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-caption text-[var(--warn)]">
          {spentWho ? `${spentWho} has already spent` : 'Spend is already'} {fmtUsd(spent ?? 0)} this period, so a hard cap of {fmtUsd(amountNum)} will
          block {spentWho ? 'them' : 'new requests'} as soon as you save.
        </p>
      ) : null}
      {duplicate ? (
        <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-caption text-[var(--warn)]">{kind === 'role-total' ? 'A combined cap for this role' : `A cap for this ${kind === 'user' ? 'person' : 'role'}`} already exists. Edit it instead.</p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-[var(--bad-bg)] px-3 py-2 text-caption text-[var(--bad)]">{error}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-[10px] px-3 py-1.5 text-size-ui font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || !dirty || saving}
          className="rounded-[10px] bg-[var(--brand-a)] px-3 py-1.5 text-size-ui font-medium text-[var(--on-brand)] hover:bg-[color-mix(in_srgb,var(--brand-a)_86%,black)] disabled:opacity-50"
        >
          {saving ? 'Saving…' : mode === 'create' ? 'Create cap' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
