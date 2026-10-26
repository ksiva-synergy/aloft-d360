'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, Shield } from 'lucide-react';
import type { UserRow } from './UserTable';

interface ChangeRoleModalProps {
  open: boolean;
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (userId: string, newRole: string) => void;
}

const ROLE_ORDER = ['platform_admin', 'admin', 'member', 'readonly'];

// Brand-palette role chips — mirrors ROLE_BADGE_CLASS in UserTable.
const ROLE_BADGE_CLASS: Record<string, string> = {
  platform_admin: 'text-[var(--brand-a-ink)] dark:text-[var(--brand-a-ink)] bg-[color-mix(in_srgb,var(--brand-a)_10%,transparent)] border-[color-mix(in_srgb,var(--brand-a)_30%,transparent)]',
  admin:          'text-[var(--brand-a-ink)] dark:text-[#5B9DFF] bg-[var(--brand-a-ink)]/[0.07] dark:bg-[#5B9DFF]/10 border-[color-mix(in_srgb,var(--brand-a-ink)_20%,transparent)] dark:border-[#5B9DFF]/25',
  member:         'text-[#5A6A7A] dark:text-[var(--ink-3)] bg-[color-mix(in_srgb,var(--ink-3)_10%,transparent)] border-[color-mix(in_srgb,var(--ink-3)_25%,transparent)]',
  readonly:       'text-[#8A9BAD] dark:text-[#5A6A85] bg-transparent border-[color-mix(in_srgb,var(--ink-3)_25%,transparent)]',
};

const ROLE_DETAILS: Record<string, { label: string; description: string }> = {
  platform_admin: {
    label: 'Platform Admin',
    description: 'Full platform access. Can see and manage all users\' sessions and data.',
  },
  admin: {
    label: 'Admin',
    description: 'All app actions but scoped to own data. Cannot view other users\' sessions.',
  },
  member: {
    label: 'Member',
    description: 'Inspector access and read-only access to all other sections.',
  },
  readonly: {
    label: 'Read Only',
    description: 'Login and view only. No writes — cannot create or modify any content.',
  },
};

function RoleBadge({ role }: { role: string }) {
  const d = ROLE_DETAILS[role] ?? ROLE_DETAILS.readonly;
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded border px-[7px] py-px',
        'font-mono text-xs font-semibold uppercase leading-[1.6] tracking-wide',
        ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.readonly,
      )}
    >
      {d.label}
    </span>
  );
}

export function ChangeRoleModal({ open, user, onOpenChange, onSuccess }: ChangeRoleModalProps) {
  const [selectedRole, setSelectedRole] = useState('readonly');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialise selection to user's current role
  useEffect(() => {
    if (user) setSelectedRole(user.primaryRole);
    setError(null);
  }, [user, open]);

  async function handleConfirm() {
    if (!user || selectedRole === user.primaryRole) {
      onOpenChange(false);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? `Failed to update role (${res.status})`);
        return;
      }

      onOpenChange(false);
      onSuccess?.(user.id, selectedRole);
    } catch {
      setError('Unexpected error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  const noChange = selectedRole === user.primaryRole;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-[var(--estate-surface)] border-[var(--estate-border)]">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--brand-a-ink)' }}
            >
              <Shield className="h-4 w-4 text-white" />
            </div>
            <DialogTitle className="text-sm">Change Role</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Updating role for{' '}
            <span className="font-medium text-[var(--foreground)]">
              {user.name || user.email}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Current role indicator */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--estate-hover)] border border-[var(--estate-border)] text-xs mt-1">
          <span className="text-muted-foreground">Current role:</span>
          <RoleBadge role={user.primaryRole} />
        </div>

        {/* Role options */}
        <div className="space-y-1.5 mt-1">
          {ROLE_ORDER.map((role) => {
            const d = ROLE_DETAILS[role];
            const isCurrent = role === user.primaryRole;
            const isSelected = role === selectedRole;

            return (
              <label
                key={role}
                className={cn(
                  'flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors',
                  isSelected
                    ? 'border-[var(--brand-a)] bg-[var(--brand-a)]/[0.07] dark:bg-[color-mix(in_srgb,var(--brand-a)_10%,transparent)] dark:border-[color-mix(in_srgb,var(--brand-a)_60%,transparent)]'
                    : 'border-[var(--estate-border)] hover:border-[var(--estate-btn-border)]',
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value={role}
                  checked={isSelected}
                  onChange={() => setSelectedRole(role)}
                  className="mt-0.5 shrink-0 accent-amber-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <RoleBadge role={role} />
                    {isCurrent && (
                      <span className="text-xs font-mono font-semibold uppercase tracking-wide text-muted-foreground">current</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>
                </div>
              </label>
            );
          })}
        </div>

        {error && (
          <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <DialogFooter className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={submitting || noChange}
            className="text-xs gap-1.5"
          >
            {submitting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating…</>
              : noChange ? 'No Change' : 'Update Role'
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
