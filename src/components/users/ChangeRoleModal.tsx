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

const ROLE_DETAILS: Record<string, { label: string; description: string; color: string; bg: string }> = {
  platform_admin: {
    label: 'Platform Admin',
    description: 'Full platform access. Can see and manage all users\' sessions and data.',
    color: '#92400e',
    bg: 'rgba(251,191,36,0.18)',
  },
  admin: {
    label: 'Admin',
    description: 'All app actions but scoped to own data. Cannot view other users\' sessions.',
    color: '#1e40af',
    bg: 'rgba(96,165,250,0.15)',
  },
  member: {
    label: 'Member',
    description: 'Inspector access and read-only access to all other sections.',
    color: '#6b7280',
    bg: 'rgba(156,163,175,0.15)',
  },
  readonly: {
    label: 'Read Only',
    description: 'Login and view only. No writes — cannot create or modify any content.',
    color: '#9ca3af',
    bg: 'rgba(209,213,219,0.12)',
  },
};

function RoleBadge({ role }: { role: string }) {
  const d = ROLE_DETAILS[role] ?? ROLE_DETAILS.readonly;
  return (
    <span
      style={{
        display: 'inline-block', padding: '1px 7px', borderRadius: 4,
        fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600,
        letterSpacing: '0.05em', textTransform: 'uppercase',
        color: d.color, background: d.bg, lineHeight: '1.6',
      }}
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
      // Assign new role
      const assignRes = await fetch('/api/access/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, roleName: selectedRole }),
      });

      if (!assignRes.ok) {
        const d = await assignRes.json();
        setError(d?.error ?? `Failed to assign role (${assignRes.status})`);
        return;
      }

      // Revoke old role(s) — revoke all existing roles that differ from new selection
      const oldRoles = user.roles.map((r) => r.role.name).filter((r) => r !== selectedRole);
      for (const roleName of oldRoles) {
        await fetch('/api/access/assignments', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, roleName }),
        });
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
      <DialogContent className="max-w-sm dark:bg-[#0d1117] dark:border-[#2d333b]">
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
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-slate-50 dark:bg-[#161b24] border border-slate-200 dark:border-[#2d333b] text-[12px] mt-1">
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
                    ? 'border-[#FDB515] bg-amber-50/60 dark:bg-amber-500/10 dark:border-[#FDB515]/60'
                    : 'border-slate-200 dark:border-[#2d333b] hover:border-slate-300 dark:hover:border-[#3d4451]',
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
