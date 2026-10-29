'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Shield } from 'lucide-react';
import type { UserRow } from './UserTable';
import { RolePickerField } from './RolePickerField';
import { RoleBadge } from './RoleBadge';

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
      <DialogContent className="max-w-md bg-[var(--estate-surface)] border-[var(--estate-border)]">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--brand-a-ink)' }}
            >
              <Shield className="h-4 w-4 text-white" />
            </div>
            <DialogTitle className="text-size-body">Change Role</DialogTitle>
          </div>
          <DialogDescription className="text-size-ui">
            Updating role for{' '}
            <span className="font-medium text-[var(--foreground)]">
              {user.name || user.email}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-dashed border-[var(--estate-btn-border)] px-3 py-2.5">
          <span className="text-eyebrow uppercase text-muted-foreground">
            Current role
          </span>
          <RoleBadge role={user.primaryRole} label={user.roleLabel} />
        </div>

        <div className="mt-3">
          <p className="mb-1.5 text-eyebrow uppercase text-muted-foreground">
            New role
          </p>
          <RolePickerField
            id="change-user-role"
            value={selectedRole}
            onChange={setSelectedRole}
            currentRole={user.primaryRole}
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-size-ui text-red-600 dark:text-red-400">
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
            className="text-size-ui"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={submitting || noChange}
            className="text-size-ui gap-1.5"
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
