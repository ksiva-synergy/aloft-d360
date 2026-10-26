'use client';

import Link from '@/lib/navigation/link';
import { usePathname } from '@/lib/navigation';
import { useEffect, useState } from 'react';
import {
  HouseIcon, MagnifyingGlassIcon, PushPinIcon, PushPinSlashIcon, XIcon,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { UserMenu } from '@/components/shell/UserMenu';
import { BrandMark } from '@/components/shell/BrandMark';
import type { Session } from 'next-auth';
import { NAV_GROUPS, groupForPath, isActive, type NavItem } from './nav-config';
import { TOGGLE_EVENT, useNavShell } from './useNavShell';
import { AuroraGlow, NavStyleToggle, useNavStyle } from './nav-shared';
import { CommandSidebar } from './CommandSidebar';

const RAIL_W = 64;
const PANEL_W = 240;

/** Renders whichever sidebar layout the user picked (command center by default). */
export function UnifiedAgentSidebar({ initialSession }: { initialSession?: Session | null }) {
  const [style] = useNavStyle();
  return style === 'rail'
    ? <RailSidebar initialSession={initialSession} />
    : <CommandSidebar initialSession={initialSession} />;
}

/** @deprecated Use UnifiedAgentSidebar instead */
export const StagingSidebar = UnifiedAgentSidebar;

/** Dispatch from the header on small screens. */
export function toggleMobileNav() {
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}

// ── Rail layout: compact pill rail + slide-out panel ─────────────────────────

function RailSidebar({ initialSession }: { initialSession?: Session | null }) {
  const pathname = usePathname();
  const isHome = pathname === '/dashboard';
  const shell = useNavShell();
  const { expanded, pinned, mobileOpen } = shell;

  const [areaId, setAreaId] = useState(() => groupForPath(pathname));
  const [filter, setFilter] = useState('');

  // Follow navigation: show the panel for the section you are in.
  useEffect(() => {
    setAreaId(groupForPath(pathname));
    setFilter('');
  }, [pathname]);

  const area = NAV_GROUPS.find((g) => g.id === areaId) ?? NAV_GROUPS[0];
  const q = filter.trim().toLowerCase();
  const items = q ? area.items.filter((i) => i.label.toLowerCase().includes(q)) : area.items;

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
        style={{ width: expanded && !mobileOpen ? RAIL_W + PANEL_W : RAIL_W }}
      />
      <aside
        {...shell.hoverProps}
        aria-label="Primary"
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen items-stretch transition-transform duration-300 ease-sidebar md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* ── Rail: a full-height vertical pill ─────────────── */}
        <nav
          className="relative flex shrink-0 flex-col items-center rounded-none px-1.5 pb-2.5"
          style={{
            width: RAIL_W,
            background: 'linear-gradient(180deg, var(--rail-bg-top) 0%, var(--rail-bg) 60%)',
          }}
        >
          <AuroraGlow />
          <div className="flex h-[var(--shell-header-h)] w-full shrink-0 items-center justify-center border-b border-[var(--header-border)]">
            <Link
              href="/dashboard"
              aria-label="Synergy Group — Data 360 home"
              className="relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--rail-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--rail-bg)]"
            >
              <BrandMark size={40} className="!rounded-full" />
            </Link>
          </div>
          <span aria-hidden className="relative my-2 h-px w-6 rounded-full bg-[var(--rail-line)]" />

          <div className="relative flex flex-col items-center gap-1">
            <RailLink href="/dashboard" label="Home" icon={HouseIcon} active={isHome} />
            {NAV_GROUPS.map((g) => (
              <RailButton
                key={g.id}
                label={g.railLabel}
                icon={g.icon}
                selected={g.id === areaId && !isHome}
                hasActive={g.items.some((i) => isActive(i, pathname))}
                onClick={() => {
                  setAreaId(g.id);
                  setFilter('');
                  shell.open();
                }}
              />
            ))}
          </div>

          <div className="relative mt-auto flex w-full justify-center">
            <UserMenu initialSession={initialSession} />
          </div>
        </nav>

        {/* ── Panel: a separate rounded card ────────────────── */}
        <div
          className={cn(
            'overflow-hidden rounded-none border-y-0 border-l-0 border-r bg-[var(--surface-1)] transition-[width,opacity,box-shadow] duration-300 ease-sidebar',
            expanded ? 'border-[var(--line-1)] opacity-100' : 'border-transparent opacity-0',
            mobileOpen && 'shadow-pop',
          )}
          style={{ width: expanded ? PANEL_W : 0 }}
          aria-hidden={!expanded}
        >
          <div className="flex h-full flex-col p-2.5" style={{ width: PANEL_W }}>
            <div className="-mx-2.5 mb-2.5 flex h-[var(--shell-header-h)] shrink-0 items-center gap-2 border-b border-[var(--header-border)] px-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[length:var(--type-caption-size)] font-semibold uppercase leading-none tracking-wide text-[var(--ink-3)]">Agent Lab</p>
                <h2 className="mt-1 truncate text-size-body font-semibold tracking-tight text-[var(--ink-1)]">
                  {isHome ? 'Home' : area.label}
                </h2>
              </div>
              <button
                onClick={() => (mobileOpen ? shell.setMobileOpen(false) : shell.togglePin())}
                aria-label={mobileOpen ? 'Close menu' : pinned ? 'Unpin sidebar' : 'Pin sidebar'}
                aria-pressed={pinned}
                title={pinned ? 'Unpin sidebar  [' : 'Keep sidebar open  ['}
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                  pinned && !mobileOpen
                    ? 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]'
                    : 'text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]',
                )}
              >
                {mobileOpen ? <XIcon size={16} /> : pinned ? <PushPinSlashIcon size={16} weight="fill" /> : <PushPinIcon size={16} />}
              </button>
            </div>
            <p className="mb-2 truncate px-2 text-size-ui text-[var(--ink-3)]">
              {isHome ? 'Your workspace overview' : area.description}
            </p>

            {!isHome && (
              <label className="mb-2 flex h-9 items-center gap-2 rounded-full border border-[var(--line-1)] bg-[var(--surface-2)] px-3 text-[var(--ink-3)] transition-colors focus-within:border-[var(--brand-a)] focus-within:bg-[var(--surface-1)] focus-within:ring-4 focus-within:ring-[var(--brand-a-soft)]">
                <MagnifyingGlassIcon size={15} className="shrink-0" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Filter ${area.label.toLowerCase()}`}
                  aria-label={`Filter ${area.label}`}
                  className="w-full bg-transparent text-[length:var(--type-ui-regular-size)] text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
                />
              </label>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {isHome ? (
                <HomePanel pathname={pathname} />
              ) : items.length === 0 ? (
                <p className="px-3 py-6 text-center text-[length:var(--type-ui-regular-size)] text-[var(--ink-3)]">No pages match “{filter}”.</p>
              ) : (
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.href}>
                      <PanelLink item={item} active={isActive(item, pathname)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-2.5 flex items-center gap-2.5 rounded-[18px] bg-[var(--surface-2)] p-2">
              <BrandMark size={28} className="!rounded-full" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[length:var(--type-caption-size)] font-semibold text-[var(--ink-1)]">Synergy Group</p>
                <p className="truncate text-[length:var(--type-caption-size)] text-[var(--ink-3)]">Data 360 · Agent Lab</p>
              </div>
              <NavStyleToggle
                current="rail"
                className="h-7 w-7 border border-[var(--line-2)] bg-[var(--surface-1)] text-[var(--ink-2)] hover:text-[var(--ink-1)]"
              />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Rail items ────────────────────────────────────────────────────────────────

function RailItem({
  label, icon: Icon, active, dot,
}: { label: string; icon: PhosphorIcon; active: boolean; dot?: boolean }) {
  return (
    <>
      <span
        className={cn(
          'relative flex h-8 w-10 items-center justify-center rounded-full transition-all duration-200',
          active
            ? 'bg-[var(--rail-active)] text-[var(--rail-ink-strong)] shadow-[0_6px_16px_-8px_var(--rail-shadow)]'
            : 'text-[var(--rail-ink)] group-hover:bg-[var(--rail-hover)] group-hover:text-[var(--rail-ink-strong)]',
        )}
      >
        <Icon size={18} weight={active ? 'fill' : 'regular'} />
        {dot && (
          <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--rail-accent)] ring-2 ring-[var(--rail-bg)]" />
        )}
      </span>
      <span
        className={cn(
          'text-[length:var(--type-caption-size)] leading-none tracking-normal transition-colors',
          active ? 'font-semibold text-[var(--rail-ink-strong)]' : 'font-medium text-[var(--rail-muted)] group-hover:text-[var(--rail-ink)]',
        )}
      >
        {label}
      </span>
    </>
  );
}

const railItemClass =
  'group flex w-[52px] flex-col items-center gap-1 rounded-[18px] py-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--rail-accent)]';

function RailLink({
  href, label, icon, active,
}: { href: string; label: string; icon: PhosphorIcon; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={railItemClass}>
      <RailItem label={label} icon={icon} active={active} />
    </Link>
  );
}

function RailButton({
  label, icon, selected, hasActive, onClick,
}: { label: string; icon: PhosphorIcon; selected: boolean; hasActive: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={selected} className={railItemClass}>
      <RailItem label={label} icon={icon} active={selected} dot={hasActive && !selected} />
    </button>
  );
}

// ── Panel items ───────────────────────────────────────────────────────────────

function PanelLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-9 items-center gap-2.5 rounded-full pl-1 pr-3 text-[length:var(--type-ui-regular-size)] transition-colors duration-150',
        active
          ? 'bg-[var(--brand-a-soft)] font-semibold text-[var(--brand-a-ink)]'
          : 'font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
          active ? 'bg-[var(--brand-a)] text-white' : 'text-[var(--ink-3)] group-hover:text-[var(--ink-1)]',
        )}
      >
        <Icon size={16} weight={active ? 'fill' : 'regular'} />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

function HomePanel({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-2.5">
      {NAV_GROUPS.map((g) => (
        <section key={g.id}>
          <h3 className="px-3 pb-1 text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide text-[var(--ink-3)]">{g.label}</h3>
          <ul className="space-y-0.5">
            {g.items.slice(0, 3).map((item) => (
              <li key={item.href}>
                <PanelLink item={item} active={isActive(item, pathname)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
