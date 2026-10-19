'use client';

import { useSession, signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { Settings, LogOut, Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppearanceControls } from './AppearanceControls';
import { forgetFirstName } from '@/lib/login-greeting';
import type { Session } from 'next-auth';

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    return name
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

/** Per-role pill — tinted bg + dark text so it stays readable on both themes. */
const ROLE_STYLES: Record<string, string> = {
  platform_admin: 'bg-[var(--warn-bg)] text-[var(--warn)]',
  admin: 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]',
  member: 'bg-[var(--surface-3)] text-[var(--ink-2)]',
  readonly: 'bg-[var(--surface-3)] text-[var(--ink-3)]',
};

function RoleBadge({ role, label }: { role: string; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold leading-none',
        ROLE_STYLES[role] ?? ROLE_STYLES.readonly,
      )}
    >
      {label}
    </span>
  );
}

const THEMES = [
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'system', label: 'System', Icon: Monitor },
] as const;

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? theme : undefined;

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex gap-1 rounded-full bg-[var(--surface-2)] p-1"
    >
      {THEMES.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={current === id}
          onClick={() => setTheme(id)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-semibold transition-colors',
            current === id
              ? 'bg-[var(--surface-1)] text-[var(--ink-1)] shadow-card'
              : 'text-[var(--ink-3)] hover:text-[var(--ink-1)]',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function UserMenu({
  initialSession,
  showLabel = false,
  placement = 'right',
}: {
  initialSession?: Session | null;
  /** Show name + role beside the avatar (expanded rail). */
  showLabel?: boolean;
  /** Where the menu opens relative to the avatar. */
  placement?: 'right' | 'top';
}) {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Force a JWT refresh on mount so role changes made by an admin are reflected
  // immediately without requiring the user to sign out and back in.
  useEffect(() => { update(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Use server-provided session immediately to avoid loading flash
  const resolvedSession = session ?? initialSession;
  const user = resolvedSession?.user as {
    name?: string | null;
    email?: string | null;
    role?: string;
    roleLabel?: string;
  } | undefined;
  const initials = getInitials(user?.name, user?.email);
  const isLoading = status === 'loading' && !initialSession;
  const displayRole = user?.roleLabel ?? user?.role ?? null;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => !isLoading && setOpen(!open)}
        disabled={isLoading}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-3 rounded-full p-1 text-left outline-none transition-colors hover:bg-[var(--rail-hover)] focus-visible:ring-2 focus-visible:ring-[var(--rail-accent)] disabled:cursor-default disabled:opacity-60"
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--rail-active)] text-[13px] font-semibold tracking-wide text-[var(--rail-ink-strong)] ring-1 ring-[var(--rail-line)]">
          {isLoading ? '…' : initials}
          <span className="absolute -bottom-px -right-px h-3 w-3 rounded-full border-2 border-[var(--rail-bg)] bg-emerald-400" />
        </span>
        {showLabel && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[var(--rail-ink-strong)]">
              {isLoading ? 'Loading…' : user?.name || user?.email || 'User'}
            </span>
            {displayRole && (
              <span className="block truncate text-xs font-medium text-[var(--rail-muted)]">{displayRole}</span>
            )}
          </span>
        )}
      </button>

      {open && user && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 w-72 overflow-hidden rounded-card border border-[var(--line-1)] bg-[var(--surface-1)] text-[var(--ink-1)] shadow-pop animate-zoom-in-95',
            placement === 'top' ? 'bottom-full left-0 mb-3' : 'bottom-0 left-full ml-3',
          )}
        >
          <div className="border-b border-[var(--line-1)] p-4">
            <div className="truncate text-base font-bold">{user.name || 'User'}</div>
            <div className="truncate text-sm text-[var(--ink-3)]">{user.email}</div>
            {displayRole && (
              <div className="mt-2">
                <RoleBadge role={user.role ?? ''} label={displayRole} />
              </div>
            )}
          </div>
          <div className="space-y-1 p-3">
            <div className="px-1 pb-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-3)]">Theme</div>
            <ThemeSwitch />
          </div>
          <div className="border-t border-[var(--line-1)] p-3">
            <AppearanceControls />
          </div>
          <div className="border-t border-[var(--line-1)] p-2">
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                router.push('/settings/profile');
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--ink-1)] transition-colors hover:bg-[var(--surface-2)]"
            >
              <Settings className="h-4 w-4 text-[var(--ink-3)]" />
              Settings
            </button>
            <button
              role="menuitem"
              onClick={() => {
                forgetFirstName(); // signing out also forgets the login page's "Welcome back" name
                signOut({ callbackUrl: '/login' });
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--bad)] transition-colors hover:bg-[var(--bad-bg)]"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
          <div className="border-t border-[var(--line-1)] bg-[var(--surface-2)] px-4 py-2 text-xs text-[var(--ink-3)]">
            Powered by ALOFT v0.4
          </div>
        </div>
      )}
    </div>
  );
}
