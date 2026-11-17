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
import type { SectionLevels } from '@/lib/sections/registry';
import { useSectionLevels } from '@/lib/sections/useSectionLevels';
import { HOME_ITEM, flatNavItems, groupForPath, isActive, isFlatNav, primaryNavHref, showHomeInNav, type NavGroup, type NavItem } from './nav-config';
import { useNavGroups } from './useNavGroups';
import { useNavShell } from './useNavShell';
import { AuroraGlow, NavStyleToggle } from './nav-shared';
import { PinnedAgentBadge, isPinnedAgentActive } from './PinnedAgentBadge';
import { usePinReorder } from './usePinReorder';

const COLLAPSED_W = 64;
const EXPANDED_W = 264;

/** Every page this person can open, flattened for the jump-to search. */
function allItems(groups: NavGroup[], levels: SectionLevels | null): (NavItem & { group: string })[] {
  const home = showHomeInNav(levels) ? [{ ...HOME_ITEM, group: 'Home' }] : [];
  return [
    ...home,
    { label: 'Profile & settings', href: '/settings/profile', icon: GearSixIcon, group: 'Home' },
    ...groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))),
  ];
}

/**
 * "Command center" sidebar: a full-height strip that collapses to icons and expands
 * on hover (or stays open when pinned), pushing the page aside rather than covering
 * it. Ctrl/⌘+K jumps to any page.
 */
export function CommandSidebar({ initialSession }: { initialSession?: Session | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const shellRole = (session ?? initialSession)?.user?.role as string | undefined;
  const shell = useNavShell({ initialRole: shellRole });
  const { expanded, pinned, mobileOpen } = shell;
  const groups = useNavGroups();
  const me = useSectionLevels();
  const levels = me?.levels ?? null;
  const logoHref = primaryNavHref(levels);
  const showHome = showHomeInNav(levels);
  const flatNav = isFlatNav(groups);

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

  const areaIndex = Math.max(0, groups.findIndex((g) => g.id === areaId));
  const area = groups[areaIndex] ?? groups[0];
  const AreaIcon = area?.icon;
  const pageItems = flatNav ? flatNavItems(groups) : (area?.items ?? []);

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      q
        ? allItems(groups, levels).filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)).slice(0, 8)
        : [],
    [q, groups, levels],
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

        {/* Header sits above the clipped body so the logo is not squeezed in the narrow rail. */}
        <div
          className={cn(
            'relative flex min-h-[var(--shell-header-h)] shrink-0 items-center border-b border-[var(--header-border)] px-3 pt-1.5 pb-1',
            expanded || mobileOpen ? 'gap-3' : 'justify-center',
          )}
        >
          <Link
            href={logoHref}
            aria-label="Synergy Group — ALOFT home"
            className="shrink-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--rail-accent)]"
          >
            <BrandMark size={30} className="!rounded-xl" />
          </Link>
          <div
            className={cn(
              'min-w-0 flex-1 whitespace-nowrap leading-tight',
              fade,
              !expanded && !mobileOpen && 'hidden',
            )}
          >
            <p className="truncate text-[length:var(--type-body-size)] font-semibold text-[var(--rail-ink-strong)]">ALOFT</p>
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
              !expanded && !mobileOpen && 'hidden',
            )}
          >
            {mobileOpen ? <XIcon size={16} /> : pinned ? <PushPinSlashIcon size={16} weight="fill" /> : <PushPinIcon size={16} />}
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-3">

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

          {/* ── Area switcher (hidden when the person only has one group, e.g. Member) ─ */}
          {!flatNav && area && AreaIcon ? (
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
                className={cn('absolute inset-y-0 left-0 grid rounded-2xl bg-[var(--rail-hover)] p-1', fade)}
                style={{ width: EXPANDED_W - 24, gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
              >
                <span
                  aria-hidden
                  className="absolute bottom-1 left-1 top-1 rounded-xl bg-[var(--rail-active)] transition-transform ease-sidebar [transition-duration:400ms]"
                  style={{
                    width: `calc((100% - 8px) / ${groups.length})`,
                    transform: `translateX(${areaIndex * 100}%)`,
                  }}
                />
                {groups.map((g) => {
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
          ) : null}

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
                {showHome ? (
                  <ul>
                    <li><Row item={HOME_ITEM} active={isActive(HOME_ITEM, pathname)} expanded={expanded} /></li>
                  </ul>
                ) : null}
                {pageItems.length > 0 ? (
                  <>
                    {!flatNav && area?.label ? (
                      <SectionLabel expanded={expanded}>{area.label}</SectionLabel>
                    ) : null}
                    <ul className="space-y-0.5">
                      {pageItems.map((item) => (
                        <li key={item.href}>
                          <Row item={item} active={isActive(item, pathname)} expanded={expanded} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <PinnedAgentsSection expanded={expanded} pathname={pathname} />
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

/** The person's pinned agents (up to 5), on every page. Click opens the agent's chat. */
function PinnedAgentsSection({ expanded, pathname }: { expanded: boolean; pathname: string }) {
  const { list, dragId, dragProps, keyProps, setPinned } = usePinReorder();
  if (list.length === 0) return null;
  return (
    <>
      <SectionLabel expanded={expanded}>Pinned agents</SectionLabel>
      <ul className="space-y-0.5">
        {list.map((agent) => {
          const active = isPinnedAgentActive(agent.useUrl, pathname);
          return (
            <li
              key={agent.id}
              {...dragProps(agent.id)}
              className={cn('group/pin relative', dragId === agent.id && 'opacity-50')}
            >
              <Link
                href={agent.useUrl}
                aria-current={active ? 'page' : undefined}
                title={expanded ? 'Drag or press Alt+↑/↓ to reorder' : agent.name}
                {...keyProps(agent.id)}
                className={cn(
                  'relative flex h-10 items-center whitespace-nowrap rounded-xl text-[length:var(--type-ui-regular-size)] font-medium outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-[var(--rail-accent)]',
                  active ? 'bg-[var(--rail-active)] text-[var(--rail-ink-strong)]' : 'text-[var(--rail-ink)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink-strong)]',
                )}
              >
                {active && (
                  <span aria-hidden className="absolute -left-3 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-[var(--rail-accent)]" />
                )}
                <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                  <PinnedAgentBadge name={agent.name} active={active} />
                </span>
                <span className={cn('min-w-0 flex-1 truncate pr-9 transition-opacity duration-200', expanded ? 'opacity-100' : 'opacity-0')}>
                  {agent.name}
                </span>
              </Link>
              {expanded && (
                <button
                  type="button"
                  onClick={() => void setPinned(agent, false)}
                  aria-label={`Unpin ${agent.name}`}
                  title="Unpin"
                  className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--rail-muted)] opacity-0 transition-opacity hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink-strong)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rail-accent)] group-hover/pin:opacity-100"
                >
                  <PushPinSlashIcon size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
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
