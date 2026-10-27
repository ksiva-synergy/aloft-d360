'use client';

import Link from '@/lib/navigation/link';
import { usePathname, useRouter } from '@/lib/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { GearSixIcon, MagnifyingGlassIcon, PushPinIcon, PushPinSlashIcon, XIcon } from '@phosphor-icons/react';
import type { Session } from 'next-auth';
import { cn } from '@/lib/utils';
import { UserMenu } from '@/components/shell/UserMenu';
import { BrandMark } from '@/components/shell/BrandMark';
import { HOME_ITEM, NAV_GROUPS, groupForPath, isActive, type NavItem } from './nav-config';
import { useNavShell } from './useNavShell';
import { AuroraGlow, NavStyleToggle } from './nav-shared';

const COLLAPSED_W = 64;
const EXPANDED_W = 264;

/** Every page, flattened for the jump-to search. */
const ALL_ITEMS: (NavItem & { group: string })[] = [
  { ...HOME_ITEM, group: 'Home' },
  { label: 'Profile & settings', href: '/settings/profile', icon: GearSixIcon, group: 'Home' },
  ...NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))),
];

/**
 * "Command center" sidebar: a full-height strip that collapses to icons and expands
 * on hover (or stays open when pinned), pushing the page aside rather than covering
 * it. Ctrl/⌘+K jumps to any page.
 */
export function CommandSidebar({ initialSession }: { initialSession?: Session | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const shell = useNavShell();
  const { expanded, pinned, mobileOpen } = shell;

  const [areaId, setAreaId] = useState(() => groupForPath(pathname));
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAreaId(groupForPath(pathname));
    setQuery('');
  }, [pathname]);

  // Ctrl/⌘+K focuses the jump-to search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        shell.open();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shell.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const areaIndex = Math.max(0, NAV_GROUPS.findIndex((g) => g.id === areaId));
  const area = NAV_GROUPS[areaIndex];
  const AreaIcon = area.icon;

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      q
        ? ALL_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)).slice(0, 8)
        : [],
    [q],
  );

  const user = (session ?? initialSession)?.user as { name?: string | null; email?: string | null; roleLabel?: string; role?: string } | undefined;

  const fade = cn('transition-opacity duration-200', expanded ? 'opacity-100 delay-75' : 'pointer-events-none opacity-0');

  return (
    <>
      {/* Scrim (mobile drawer only) */}
      <div
        aria-hidden
        onClick={() => shell.setMobileOpen(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Layout slot: always matches the sidebar's width, so the page slides with it instead of being covered. */}
      <div
        aria-hidden
        className="relative hidden shrink-0 transition-[width] duration-300 ease-sidebar md:block"
        style={{ width: expanded && !mobileOpen ? EXPANDED_W : COLLAPSED_W }}
      />

      <aside
        {...shell.hoverProps}
        aria-label="Primary"
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen flex-col rounded-none border-r border-[var(--rail-line)] text-[var(--rail-ink)]',
          mobileOpen && 'shadow-[12px_0_32px_-16px_var(--rail-shadow)]',
          'transition-[width,transform] duration-300 ease-sidebar md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{
          width: expanded ? EXPANDED_W : COLLAPSED_W,
          background: 'linear-gradient(180deg, var(--rail-bg-top) 0%, var(--rail-bg) 65%)',
        }}
      >
        <AuroraGlow />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-3">
          {/* ── Workspace header (height matches StagingHeader in light and dark) ─ */}
          <div className="-mx-3 flex h-[var(--shell-header-h)] shrink-0 items-center gap-3 border-b border-[var(--header-border)] px-3">
            <Link
              href="/dashboard"
              aria-label="Synergy Group — Data 360 home"
              className="shrink-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--rail-accent)]"
            >
              <BrandMark size={40} className="!rounded-xl" />
            </Link>
            <div className={cn('min-w-0 flex-1 whitespace-nowrap leading-tight', fade)}>
              <p className="truncate text-[length:var(--type-body-size)] font-semibold text-[var(--rail-ink-strong)]">Data 360</p>
              <p className="truncate text-[length:var(--type-caption-size)] text-[var(--rail-muted)]">Synergy Group · Agent Lab</p>
            </div>
            <button
              onClick={() => (mobileOpen ? shell.setMobileOpen(false) : shell.togglePin())}
              aria-label={mobileOpen ? 'Close menu' : pinned ? 'Unpin sidebar' : 'Pin sidebar'}
              aria-pressed={pinned}
              tabIndex={expanded ? 0 : -1}
              title={pinned ? 'Unpin sidebar  [' : 'Keep sidebar open  ['}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                pinned && !mobileOpen ? 'bg-[var(--rail-active)] text-[var(--rail-ink-strong)]' : 'text-[var(--rail-muted)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink-strong)]',
                fade,
              )}
            >
              {mobileOpen ? <XIcon size={16} /> : pinned ? <PushPinSlashIcon size={16} weight="fill" /> : <PushPinIcon size={16} />}
            </button>
          </div>

          {/* ── Jump-to search ─────────────────────────────── */}
          <label
            className={cn(
              'mt-3.5 flex h-10 shrink-0 cursor-text items-center rounded-xl border transition-colors',
              'border-[var(--rail-line)] bg-[var(--rail-hover)] focus-within:border-[var(--rail-accent)] focus-within:bg-[var(--rail-active)]',
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--rail-muted)]">
              <MagnifyingGlassIcon size={18} />
            </span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
                if (e.key === 'Enter' && results[cursor]) { router.push(results[cursor].href); e.currentTarget.blur(); }
                if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
              }}
              placeholder="Search or jump to…"
              aria-label="Search pages"
              className={cn('w-full min-w-0 bg-transparent text-[length:var(--type-ui-regular-size)] text-[var(--rail-ink-strong)] outline-none placeholder:text-[var(--rail-muted)]', fade)}
            />
            <kbd className={cn('mr-2 shrink-0 rounded-md bg-[var(--rail-hover)] px-1.5 py-0.5 font-sans text-[length:var(--type-caption-size)] font-semibold text-[var(--rail-ink)]', fade)}>
              Ctrl K
            </kbd>
          </label>

          {/* ── Area switcher ──────────────────────────────── */}
          <div className="relative mt-3 h-[52px] shrink-0">
            {/* collapsed: current area only */}
            <span
              aria-hidden
              className={cn(
                'absolute left-0 top-1.5 flex h-10 w-10 items-center justify-center rounded-xl text-[var(--rail-ink-strong)] transition-opacity duration-150',
                'bg-[var(--rail-active)]',
                expanded ? 'opacity-0' : 'opacity-100',
              )}
            >
              <AreaIcon size={18} />
            </span>
            {/* expanded: segmented control with a sliding highlight */}
            <div
              role="tablist"
              aria-label="Area"
              className={cn('absolute inset-y-0 left-0 grid grid-cols-4 rounded-2xl bg-[var(--rail-hover)] p-1', fade)}
              style={{ width: EXPANDED_W - 24 }}
            >
              <span
                aria-hidden
                className="absolute bottom-1 left-1 top-1 rounded-xl bg-[var(--rail-active)] transition-transform ease-sidebar [transition-duration:400ms]"
                style={{ width: 'calc((100% - 8px) / 4)', transform: `translateX(${areaIndex * 100}%)` }}
              />
              {NAV_GROUPS.map((g) => {
                const Icon = g.icon;
                const selected = g.id === areaId;
                const hasActive = g.items.some((i) => isActive(i, pathname));
                return (
                  <button
                    key={g.id}
                    role="tab"
                    aria-selected={selected}
                    tabIndex={expanded ? 0 : -1}
                    onClick={() => setAreaId(g.id)}
                    className={cn(
                      'relative z-[1] flex flex-col items-center justify-center gap-0.5 rounded-xl text-[length:var(--type-caption-size)] font-medium transition-colors',
                      selected ? 'text-[var(--rail-ink-strong)]' : 'text-[var(--rail-muted)] hover:text-[var(--rail-ink-strong)]',
                    )}
                  >
                    <Icon size={17} weight={selected ? 'fill' : 'regular'} />
                    {g.railLabel}
                    {hasActive && !selected && (
                      <span aria-hidden className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--rail-accent)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Pages ──────────────────────────────────────── */}
          <div className="-mx-3 mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 [scrollbar-width:none]">
            {q ? (
              <>
                <SectionLabel expanded={expanded}>Results</SectionLabel>
                {results.length === 0 ? (
                  <p className={cn('px-2 py-4 text-[length:var(--type-ui-regular-size)] text-[var(--rail-muted)]', fade)}>No pages match “{query}”.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {results.map((item, i) => (
                      <li key={item.href}>
                        <Row item={item} active={i === cursor} hint={item.group} expanded={expanded} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <ul>
                  <li><Row item={HOME_ITEM} active={isActive(HOME_ITEM, pathname)} expanded={expanded} /></li>
                </ul>
                <SectionLabel expanded={expanded}>{area.label}</SectionLabel>
                <ul className="space-y-0.5">
                  {area.items.map((item) => (
                    <li key={item.href}>
                      <Row item={item} active={isActive(item, pathname)} expanded={expanded} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* ── Account (outside the clipped body so its menu can overflow) ── */}
        <div className="relative px-2 pb-2.5">
          <div
            className={cn(
              'flex items-center gap-2 rounded-2xl transition-colors duration-200',
              expanded ? 'bg-[var(--rail-hover)]' : 'bg-transparent',
            )}
          >
            <UserMenu initialSession={initialSession} placement="top" />
            <div className={cn('min-w-0 flex-1 whitespace-nowrap leading-tight', fade)}>
              <p className="truncate text-[length:var(--type-ui-regular-size)] font-semibold text-[var(--rail-ink-strong)]">{user?.name || user?.email || 'User'}</p>
              {(user?.roleLabel ?? user?.role) && (
                <p className="truncate text-[length:var(--type-caption-size)] text-[var(--rail-muted)]">{user?.roleLabel ?? user?.role}</p>
              )}
            </div>
            <NavStyleToggle
              current="command"
              className={cn('mr-1.5 h-8 w-8 text-[var(--rail-muted)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink-strong)]', fade)}
            />
          </div>
        </div>
      </aside>
    </>
  );
}

function SectionLabel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  return (
    <div className="relative flex h-8 items-center">
      <span
        aria-hidden
        className={cn('absolute left-2 h-px w-6 bg-[var(--rail-line)] transition-opacity', expanded ? 'opacity-0' : 'opacity-100')}
      />
      <span
        className={cn(
          'whitespace-nowrap px-2 text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide text-[var(--rail-muted)] transition-opacity',
          expanded ? 'opacity-100' : 'opacity-0',
        )}
      >
        {children}
      </span>
    </div>
  );
}

function Row({ item, active, hint, expanded }: { item: NavItem; active: boolean; hint?: string; expanded: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={expanded ? undefined : item.label}
      className={cn(
        'group relative flex h-10 items-center whitespace-nowrap rounded-xl text-[length:var(--type-ui-regular-size)] font-medium outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-[var(--rail-accent)]',
        active ? 'bg-[var(--rail-active)] text-[var(--rail-ink-strong)]' : 'text-[var(--rail-ink)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink-strong)]',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-3 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-[var(--rail-accent)]"
        />
      )}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center">
        <Icon size={18} weight={active ? 'fill' : 'regular'} />
      </span>
      <span className={cn('min-w-0 flex-1 truncate pr-3 transition-opacity duration-200', expanded ? 'opacity-100' : 'opacity-0')}>
        {item.label}
      </span>
      {hint && expanded && <span className="mr-3 shrink-0 text-[length:var(--type-caption-size)] text-[var(--rail-muted)]">{hint}</span>}
    </Link>
  );
}
