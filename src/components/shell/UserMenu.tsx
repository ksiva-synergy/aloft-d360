'use client';

import { useSession, signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { Settings, LogOut, Sun, Moon, Monitor, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
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

/** Per-role badge style — color tokens are CSS variables so they respect both light and dark themes. */
const ROLE_BADGE_STYLES: Record<string, { color: string; bg: string }> = {
  platform_admin: { color: '#92400e', bg: 'rgba(251,191,36,0.18)' }, // amber
  admin:          { color: '#1e40af', bg: 'rgba(96,165,250,0.15)' },  // blue
  member:         { color: '#6b7280', bg: 'rgba(156,163,175,0.15)' }, // gray
  readonly:       { color: '#9ca3af', bg: 'rgba(209,213,219,0.12)' }, // muted
};

function RoleBadge({ role, label }: { role: string; label: string }) {
  const style = ROLE_BADGE_STYLES[role] ?? ROLE_BADGE_STYLES.readonly;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 9,
        fontFamily: '"IBM Plex Mono", monospace',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: style.color,
        background: style.bg,
        lineHeight: '1.6',
      }}
    >
      {label}
    </span>
  );
}

function ThemeCycleButton() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  function cycleTheme() {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  }

  if (!mounted) {
    return <div className="w-6 h-6" />;
  }

  const Icon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;
  const label =
    theme === 'system' ? 'System' : resolvedTheme === 'dark' ? 'Dark' : 'Light';

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      title={`Theme: ${label}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export function UserMenu({ initialSession }: { initialSession?: Session | null }) {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Force a JWT refresh on mount so role changes made by an admin are reflected
  // immediately without requiring the user to sign out and back in.
  useEffect(() => { update(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
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

  // Use roleLabel from session when available; fall back to role name as-is.
  const displayRole = user?.roleLabel ?? user?.role ?? null;

  return (
    <div ref={menuRef} className="relative px-3 py-2 border-t border-[var(--header-border)]">
      {/* User identity row — shows skeleton while loading */}
      <button
        onClick={() => !isLoading && setOpen(!open)}
        disabled={isLoading}
        className="flex items-center gap-2.5 w-full rounded-md px-1.5 py-1.5 hover:bg-[var(--muted)] transition-colors text-left disabled:opacity-50 disabled:cursor-default"
      >
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0" style={{ background: '#003262', color: '#FDB515' }}>
          {isLoading ? '…' : initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-[var(--foreground)] truncate">
            {isLoading ? 'Loading…' : (user?.name || user?.email || 'User')}
          </div>
          {displayRole && (
            <div className="mt-0.5">
              <RoleBadge role={user?.role ?? ''} label={displayRole} />
            </div>
          )}
        </div>
        <ChevronUp
          className={cn(
            'h-3 w-3 text-[var(--muted-foreground)] transition-transform shrink-0',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Theme toggle + footer — always visible */}
      <div className="flex items-center justify-between mt-1 px-1">
        <ThemeCycleButton />
        <span
          className="text-[10px] font-mono truncate"
          style={{ color: 'var(--nav-section-label)', fontFamily: '"IBM Plex Mono", monospace' }}
        >
          Powered by ALOFT v0.4
        </span>
      </div>

      {open && user && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-[var(--card)] border border-[var(--header-border)] rounded-lg shadow-lg overflow-hidden z-50">
          <div className="px-3 py-2.5 border-b border-[var(--header-border)]">
            <div className="text-[12px] font-medium text-[var(--foreground)] truncate">
              {user.name || 'User'}
            </div>
            <div className="text-[11px] text-[#8892A4] truncate">{user.email}</div>
            {displayRole && (
              <div className="mt-1.5">
                <RoleBadge role={user.role ?? ''} label={displayRole} />
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              router.push('/settings/profile');
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
