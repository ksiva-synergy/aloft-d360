'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, Eye, EyeOff, UserPlus } from 'lucide-react';

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

const ROLE_DESCRIPTIONS: Record<string, string> = {
  platform_admin: 'Full access · sees all users\' data',
  admin:          'All actions · own data only',
  member:         'Inspector access · read-only elsewhere',
  readonly:       'Login and view only · no writes',
};

// Brand-palette role chips — mirrors ROLE_BADGE_CLASS in UserTable.
const ROLE_BADGE_CLASS: Record<string, string> = {
  platform_admin: 'text-[#8a6a12] dark:text-[#FDB515] bg-[#FDB515]/10 border-[#FDB515]/30',
  admin:          'text-[#003262] dark:text-[#5B9DFF] bg-[#003262]/[0.07] dark:bg-[#5B9DFF]/10 border-[#003262]/20 dark:border-[#5B9DFF]/25',
  member:         'text-[#5A6A7A] dark:text-[#8892A4] bg-[#8892A4]/10 border-[#8892A4]/25',
  readonly:       'text-[#8A9BAD] dark:text-[#5A6A85] bg-transparent border-[#8892A4]/25',
};

const ROLE_ORDER = ['platform_admin', 'admin', 'member', 'readonly'];

function RoleBadge({ role, label }: { role: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded border px-1.5 py-px',
        'font-mono text-[10px] font-semibold uppercase leading-[1.6] tracking-[0.05em]',
        ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.readonly,
      )}
    >
      {label ?? role}
    </span>
  );
}

export function InviteUserModal({ open, onOpenChange, onSuccess }: InviteUserModalProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState('member');
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load roles when modal opens
  useEffect(() => {
    if (!open) return;
    setRolesLoading(true);
    fetch('/api/access/roles')
      .then((r) => r.json())
      .then((d: { roles?: Role[] }) => {
        const sorted = (d.roles ?? []).sort(
          (a, b) => ROLE_ORDER.indexOf(a.name) - ROLE_ORDER.indexOf(b.name),
        );
        setRoles(sorted);
      })
      .catch(() => {})
      .finally(() => setRolesLoading(false));
  }, [open]);

  // Reset form when modal closes
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
    if (!email.trim()) return;

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[var(--estate-surface)] border-[var(--estate-border)]">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: '#003262' }}
            >
              <UserPlus className="h-4 w-4 text-white" />
            </div>
            <DialogTitle className="text-[15px]">Invite User</DialogTitle>
          </div>
          <DialogDescription className="text-[12.5px]">
            Create a new platform account. The user can sign in with their email and password.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-1">
          {/* Email */}
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--foreground)] mb-1.5">
              Email address <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              className={cn(
                'w-full px-3 py-2 text-[12.5px] rounded-md border',
                'bg-[var(--estate-surface)] border-[var(--estate-border)] text-[var(--estate-ink)]',
                'focus:outline-none focus:ring-1 focus:ring-[#FDB515] dark:focus:ring-[#FDB515]',
                'placeholder:text-muted-foreground',
              )}
            />
          </div>

          {/* Display name */}
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--foreground)] mb-1.5">
              Display name <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              className={cn(
                'w-full px-3 py-2 text-[12.5px] rounded-md border',
                'bg-[var(--estate-surface)] border-[var(--estate-border)] text-[var(--estate-ink)]',
                'focus:outline-none focus:ring-1 focus:ring-[#FDB515]',
                'placeholder:text-muted-foreground',
              )}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--foreground)] mb-1.5">
              Password <span className="text-muted-foreground font-normal">(optional — omit for SSO-only)</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                minLength={password ? 8 : undefined}
                className={cn(
                  'w-full px-3 py-2 pr-9 text-[12.5px] rounded-md border',
                  'bg-[var(--estate-surface)] border-[var(--estate-border)] text-[var(--estate-ink)]',
                  'focus:outline-none focus:ring-1 focus:ring-[#FDB515]',
                  'placeholder:text-muted-foreground',
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--foreground)] mb-1.5">
              Role <span className="text-red-500">*</span>
            </label>
            {rolesLoading ? (
              <div className="flex items-center gap-2 py-3 text-muted-foreground text-[12.5px]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading roles…
              </div>
            ) : (
              <div className="space-y-1.5">
                {(roles.length > 0 ? roles : ROLE_ORDER.map((r) => ({ id: r, name: r, permissions: [] }))).map((role) => (
                  <label
                    key={role.name}
                    className={cn(
                      'flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors',
                      selectedRole === role.name
                        ? 'border-[#FDB515] bg-[#FDB515]/[0.07] dark:bg-[#FDB515]/10 dark:border-[#FDB515]/60'
                        : 'border-[var(--estate-border)] hover:border-[var(--estate-btn-border)]',
                    )}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={role.name}
                      checked={selectedRole === role.name}
                      onChange={() => setSelectedRole(role.name)}
                      className="mt-0.5 shrink-0 accent-amber-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <RoleBadge role={role.name} />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {ROLE_DESCRIPTIONS[role.name] ?? role.description ?? ''}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
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
              type="submit"
              size="sm"
              disabled={submitting || !email.trim()}
              className="text-[12.5px] gap-1.5"
            >
              {submitting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating…</> : 'Create User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
