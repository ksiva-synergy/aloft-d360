'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Shield } from 'lucide-react';
import type { UserRow } from './UserTable';
import { RolePickerField } from './RolePickerField';
import { RoleBadge } from './RoleBadge';
import { cn } from '@/lib/utils';
import styles from './users.module.css';
import { UserDialogContent } from './UserDialogContent';

interface ChangeRoleModalProps {
  open: boolean;
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (userId: string, newRole: string) => void;
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
      <UserDialogContent open={open} labelledBy="change-role-title">
        <DialogHeader className={cn(styles.dialogHeader, '!mb-0')}>
          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-9 h-9 rounded-xl bg-[color-mix(in_srgb,var(--brand-a)_10%,transparent)] text-[var(--brand-a-ink)] flex items-center justify-center shrink-0"
            >
              <Shield className="h-4 w-4" />
            </div>
            <DialogTitle id="change-role-title" className="text-title-section">Change role</DialogTitle>
          </div>
          <DialogDescription className="text-size-ui">
            Updating role for{' '}
            <span className="font-medium text-[var(--foreground)]">
              {user.name || user.email}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className={styles.formBody}>
        <div className={cn(styles.notice, 'items-center justify-between')}>
          <span className="text-size-ui text-muted-foreground">
            Current role
          </span>
          <RoleBadge role={user.primaryRole} label={user.roleLabel} className="!rounded-full !px-3 !py-1.5" />
        </div>

        <div>
          <label htmlFor="change-user-role" className="block mb-3 text-size-ui font-medium">
            New role
          </label>
          <RolePickerField
            id="change-user-role"
            value={selectedRole}
            onChange={setSelectedRole}
            currentRole={user.primaryRole}
            layout="compact"
            showDetailPanel
          />
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-size-ui text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        </div>
        <DialogFooter className={styles.dialogFooter}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className={cn(styles.secondaryButton, 'text-size-ui')}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={submitting || noChange}
            className={cn(styles.primary, 'text-size-ui gap-2')}
          >
            {submitting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Updating…</>
              : noChange ? 'No Change' : 'Update Role'
            }
          </Button>
        </DialogFooter>
      </UserDialogContent>
    </Dialog>
  );
}
