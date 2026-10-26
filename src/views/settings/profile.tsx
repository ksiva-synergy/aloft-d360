'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppearanceControls } from '@/components/shell/AppearanceControls';
import { CompanionSettings } from '@/components/companion/CompanionSettings';

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
      className="flex max-w-md gap-1 rounded-full bg-[var(--surface-2)] p-1"
    >
      {THEMES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={current === id}
          onClick={() => setTheme(id)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-semibold transition-colors',
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

export default function ProfileSettingsPage() {
  const { data: session, status } = useSession();
  const user = session?.user as {
    name?: string | null;
    email?: string | null;
    role?: string;
    roleLabel?: string;
  } | undefined;

  const loading = status === 'loading';
  const displayRole = user?.roleLabel ?? user?.role;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ink-1)]">Profile &amp; appearance</h1>
        <p className="mt-1 text-sm text-[var(--ink-3)]">
          Your account details and how ALOFT looks in this browser.
        </p>
      </div>

      <section className="rounded-card border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--brand-a-soft)] text-base font-semibold text-[var(--brand-a-ink)] ring-1 ring-[var(--line-1)]"
            aria-hidden
          >
            {loading ? '…' : getInitials(user?.name, user?.email)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-3)]">
              <User className="h-4 w-4" />
              Account
            </div>
            {loading ? (
              <p className="mt-2 text-sm text-[var(--ink-3)]">Loading session…</p>
            ) : (
              <>
                <p className="mt-2 truncate text-lg font-semibold text-[var(--ink-1)]">{user?.name || 'User'}</p>
                <p className="truncate text-sm text-[var(--ink-3)]">{user?.email}</p>
                {displayRole && (
                  <p className="mt-2 inline-flex rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-xs font-semibold text-[var(--ink-2)]">
                    {displayRole}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-card border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[var(--ink-1)]">Theme</h2>
        <p className="mt-1 text-sm text-[var(--ink-3)]">Light, dark, or follow your system preference.</p>
        <div className="mt-4">
          <ThemeSwitch />
        </div>
      </section>

      <section className="rounded-card border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[var(--ink-1)]">Colors</h2>
        <p className="mt-1 text-sm text-[var(--ink-3)]">Accent and sidebar colors are saved locally in this browser.</p>
        <div className="mt-4 border-t border-[var(--line-1)] pt-4">
          <AppearanceControls />
        </div>
      </section>
      <CompanionSettings />
    </div>
  );
}
