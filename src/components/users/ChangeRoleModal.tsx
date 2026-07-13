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
  platform_admin: 'text-[#8a6a12] dark:text-[#FDB515] bg-[#FDB515]/10 border-[#FDB515]/30',
  admin:          'text-[#003262] dark:text-[#5B9DFF] bg-[#003262]/[0.07] dark:bg-[#5B9DFF]/10 border-[#003262]/20 dark:border-[#5B9DFF]/25',
  member:         'text-[#5A6A7A] dark:text-[#8892A4] bg-[#8892A4]/10 border-[#8892A4]/25',
  readonly:       'text-[#8A9BAD] dark:text-[#5A6A85] bg-transparent border-[#8892A4]/25',
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
        'font-mono text-[10px] font-semibold uppercase leading-[1.6] tracking-[0.05em]',
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
              style={{ background: '#003262' }}
            >
              <Shield className="h-4 w-4 text-white" />
            </div>
            <DialogTitle className="text-[15px]">Change Role</DialogTitle>
          </div>
          <DialogDescription className="text-[12.5px]">
            Updating role for{' '}
            <span className="font-medium text-[var(--foreground)]">
              {user.name || user.email}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Current role indicator */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--estate-hover)] border border-[var(--estate-border)] text-[12px] mt-1">
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
                    ? 'border-[#FDB515] bg-[#FDB515]/[0.07] dark:bg-[#FDB515]/10 dark:border-[#FDB515]/60'
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
                      <span className="text-[9px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">current</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{d.description}</p>
                </div>
              </label>
            );
          })}
        </div>

        {error && (
          <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-400">
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
            className="text-[12.5px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={submitting || noChange}
            className="text-[12.5px] gap-1.5"
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
