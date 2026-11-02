'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, Eye, EyeOff, UserPlus, X, ShieldCheck } from 'lucide-react';
import { ROLE_ORDER } from './role-copy';
import { RolePickerField } from './RolePickerField';
import { UserDialogContent } from './UserDialogContent';
import styles from './users.module.css';

interface Role {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
}

interface InviteUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function InviteUserModal({ open, onOpenChange, onSuccess }: InviteUserModalProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState('member');
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRolesLoading(true);
    setRolesError(false);
    fetch('/api/access/roles')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load roles (${r.status})`);
        return r.json();
      })
      .then((d: { roles?: Role[] }) => {
        if (cancelled) return;
        if (!d.roles?.length) throw new Error('No roles available');
        setRoles([...d.roles].sort(
          (a, b) => (ROLE_ORDER as readonly string[]).indexOf(a.name) - (ROLE_ORDER as readonly string[]).indexOf(b.name),
        ));
      })
      .catch(() => { if (!cancelled) setRolesError(true); })
      .finally(() => { if (!cancelled) setRolesLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setName('');
      setPassword('');
      setShowPassword(false);
      setSelectedRole('member');
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || rolesLoading || rolesError) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        email: email.trim().toLowerCase(),
        roles: [selectedRole],
      };
      if (name.trim()) body.name = name.trim();
      if (password.trim()) body.password = password;
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Failed to create user (${res.status})`);
        return;
      }
      onOpenChange(false);
      onSuccess?.();
    } catch {
      setError('Unexpected error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!submitting) onOpenChange(value); }}>
      <UserDialogContent open={open} labelledBy="invite-title" describedBy="invite-description">
          <DialogHeader className={cn(styles.dialogHeader, '!mb-0')}>
            <div className="flex items-start gap-4 mb-5">
              <div className="w-9 h-9 rounded-xl bg-[color-mix(in_srgb,var(--brand-a)_10%,transparent)] text-[var(--brand-a-ink)] flex items-center justify-center shrink-0">
                <UserPlus className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-caption text-muted-foreground mb-1">Grow your workspace</p>
                <DialogTitle id="invite-title" className="text-title-section">Invite a new user</DialogTitle>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} disabled={submitting} aria-label="Close invite dialog" className={cn(styles.iconButton, 'shrink-0 disabled:opacity-40')}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <DialogDescription id="invite-description" className="!text-size-ui !text-[var(--estate-text-dim)]">
              Give someone access to the platform. Choose their role and how they sign in.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <div className={styles.formBody}>
              <div className={styles.notice}>
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-[var(--brand-a-ink)]" />
                <div>
                  <p className="text-size-ui font-medium">Microsoft single sign-on</p>
                  <p className="mt-1 text-caption text-muted-foreground">Leave the password empty for SSO-only access. Creating an account does not send an invitation email.</p>
                </div>
              </div>
              <div>
                <label htmlFor="invite-email" className="block text-size-ui font-medium mb-2">
                  Email address <span className="text-red-500">*</span>
                </label>
                <input id="invite-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={styles.input} />
              </div>
              <div>
                <label htmlFor="invite-name" className="block text-size-ui font-medium mb-2">
                  Display name <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input id="invite-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" className={styles.input} />
              </div>
              <div>
                <label htmlFor="invite-password" className="block text-size-ui font-medium mb-2">
                  Password <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <input id="invite-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" aria-describedby="invite-password-help" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" minLength={password ? 8 : undefined} className={cn(styles.input, '!pr-10')} />
                  <button type="button" onClick={() => setShowPassword((p) => !p)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p id="invite-password-help" className="mt-2 text-caption text-muted-foreground">At least 8 characters. Enables email and password sign-in.</p>
              </div>
              <div>
                <label htmlFor="invite-user-role" className="block text-size-ui font-medium mb-2">
                  Role <span className="text-red-500">*</span>
                </label>
                {rolesLoading ? (
                  <div className="flex items-center gap-2 py-3 text-muted-foreground text-size-ui"><Loader2 className="h-4 w-4 animate-spin" />Loading roles...</div>
                ) : rolesError ? (
                  <p role="alert" className="text-size-ui text-red-600 dark:text-red-400">Unable to load available roles. Close this dialog and try again.</p>
                ) : (
                  <RolePickerField id="invite-user-role" value={selectedRole} onChange={setSelectedRole} layout="compact" showDetailPanel options={roles.map((r) => r.name)} />
                )}
              </div>
              {error && <div role="alert" className="rounded-sm border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-size-ui text-red-600 dark:text-red-400">{error}</div>}
            </div>
            <DialogFooter className={styles.dialogFooter}>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className={cn(styles.secondaryButton, 'text-size-ui')}>Cancel</Button>
              <Button type="submit" disabled={submitting || !email.trim() || rolesLoading || rolesError} className={cn(styles.primary, 'text-size-ui gap-2')}>
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Creating...</> : <><UserPlus className="h-4 w-4" />Create user</>}
              </Button>
            </DialogFooter>
          </form>
      </UserDialogContent>
    </Dialog>
  );
}
