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

const ROLE_BADGE: Record<string, { color: string; bg: string }> = {
  platform_admin: { color: '#92400e', bg: 'rgba(251,191,36,0.18)' },
  admin:          { color: '#1e40af', bg: 'rgba(96,165,250,0.15)' },
  member:         { color: '#6b7280', bg: 'rgba(156,163,175,0.15)' },
  readonly:       { color: '#9ca3af', bg: 'rgba(209,213,219,0.12)' },
};

const ROLE_ORDER = ['platform_admin', 'admin', 'member', 'readonly'];

function RoleBadge({ role, label }: { role: string; label?: string }) {
  const style = ROLE_BADGE[role] ?? ROLE_BADGE.readonly;
  return (
    <span
      style={{
        display: 'inline-block', padding: '1px 6px', borderRadius: 4,
        fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600,
        letterSpacing: '0.05em', textTransform: 'uppercase',
        color: style.color, background: style.bg, lineHeight: '1.6',
      }}
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
  const [selectedRole, setSelectedRole] = useState('readonly');
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
      setSelectedRole('readonly');
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
      <DialogContent className="max-w-md dark:bg-[#0d1117] dark:border-[#2d333b]">
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
                'bg-white dark:bg-[#161b24] dark:border-[#2d333b]',
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
                'bg-white dark:bg-[#161b24] dark:border-[#2d333b]',
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
                  'bg-white dark:bg-[#161b24] dark:border-[#2d333b]',
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
                        ? 'border-[#FDB515] bg-amber-50/60 dark:bg-amber-500/10 dark:border-[#FDB515]/60'
                        : 'border-slate-200 dark:border-[#2d333b] hover:border-slate-300 dark:hover:border-[#3d4451]',
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
