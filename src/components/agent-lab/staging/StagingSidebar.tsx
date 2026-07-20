'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Activity, GitBranch, BookOpen, BookMarked, Database, Beaker, Dices,
  Rocket, FlaskConical, Inbox, HeartPulse, DollarSign,
  Shield, Server, ScrollText, Layers, Wand2,
  Radio, Brain, Lightbulb, LayoutTemplate, Route, LayoutDashboard,
  ChevronRight, History, Zap, Users, TestTube2, Ruler,
} from 'lucide-react';
import { UserMenu } from '@/components/shell/UserMenu';
import type { Session } from 'next-auth';
import { ESTATE_NAV_ITEMS } from '@/lib/estate/nav-items';

interface NavItem {
  label: string;
  href: string;
  icon?: React.ElementType;
  badge?: number;
  badgeVariant?: 'default' | 'warn';
  exact?: boolean;
  children?: NavItem[];
}

interface NavGroup {
  label: string;
  id: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Build',
    id: 'build',
    items: [
      { label: 'Inspector',        href: '/inspector',            icon: Database },
      { label: 'Dashboards',       href: '/inspector/dashboards', icon: LayoutDashboard },
      { label: 'Metrics',          href: '/agent-lab/metrics',    icon: Ruler },
      { label: 'Teach',            href: '/agent-lab/teach',        icon: Wand2 },
      { label: 'Performance Lab',  href: '/performance-lab',      icon: TestTube2 },
      { label: 'Bandits',          href: '/agent-lab/bandits',    icon: Dices },
      { label: 'History',          href: '/agent-lab/history',    icon: History },
    ],
  },
  {
    label: 'Memory',
    id: 'memory',
    items: [
      { label: 'FOER',                  href: '/agent-lab/memory',               icon: Lightbulb, exact: true },
      { label: 'FOER Ops',              href: '/agent-lab/memory/ops',            icon: Activity },
      { label: 'Contributions',         href: '/agent-lab/memory/contributions',  icon: Brain },
    ],
  },
  {
    label: 'Data Estate',
    id: 'estate',
    // Single source of truth shared with the in-page tab bar (EstateNav) so the
    // two can't drift — Entities + Lineage used to be missing here.
    items: ESTATE_NAV_ITEMS.map((it) => ({
      label: it.label,
      href: it.href,
      icon: it.icon,
      exact: it.match === 'exact',
    })),
  },
  {
    label: 'Govern',
    id: 'govern',
    items: [
      { label: 'Users',           href: '/agent-staging/users',        icon: Users },
      { label: 'Policies',        href: '/agent-staging/policies',     icon: Shield },
      { label: 'Audit Log',       href: '/agent-staging/audit',        icon: ScrollText },
      { label: 'Docs',            href: '/docs',                       icon: BookMarked },
    ],
  },
];

function itemContainsPath(item: NavItem, pathname: string): boolean {
  const isSelfActive = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + '/');

  if (isSelfActive) return true;

  if (item.children) {
    return item.children.some((child) => itemContainsPath(child, pathname));
  }

  return false;
}

function groupContainsPath(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => itemContainsPath(item, pathname));
}

export function UnifiedAgentSidebar({ initialSession }: { initialSession?: Session | null }) {
  const pathname = usePathname();

  // Initialise: open only the group that contains the active route
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const group of NAV_GROUPS) {
      init[group.id] = groupContainsPath(group, pathname);
    }
    return init;
  });

  // When the route changes (e.g. navigation), open the matching group
  useEffect(() => {
    const active = NAV_GROUPS.find((g) => groupContainsPath(g, pathname));
    if (active && !openGroups[active.id]) {
      setOpenGroups((prev) => ({ ...prev, [active.id]: true }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggle(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <aside
      className={cn(
        'w-[224px] shrink-0 flex flex-col overflow-hidden h-screen',
        'bg-[var(--nav-bg)] border-r border-[var(--nav-border)]',
      )}
      style={{ width: '224px', minWidth: '224px', flexShrink: 0 }}
    >
      {/* Brand header */}
      <div
        className="px-4 pt-4 pb-3 flex items-center gap-2.5 border-b border-[var(--nav-border)] shrink-0"
        style={{ background: 'var(--nav-bg)' }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: '#003262' }}
        >
          <Layers className="h-3.5 w-3.5 text-white" />
        </div>
        <div>
          <div
            className="text-[13px] font-semibold tracking-[0.12em] uppercase"
            style={{ fontFamily: '"Inter Tight", Inter, sans-serif', color: 'var(--nav-text)' }}
          >
            SPINOR LABS
          </div>
          <div
            className="text-[10px] font-mono font-medium tracking-widest uppercase"
            style={{ color: '#FDB515', fontFamily: '"IBM Plex Mono", monospace' }}
          >
            AGENT LAB
          </div>
        </div>
      </div>

      <div className="flex-1 px-2 pb-2 overflow-y-auto min-h-0">
        {/* Dashboard — standalone home link above all groups */}
        <Link
          href="/dashboard"
          className={cn(
            'agent-nav-link flex items-center gap-2 px-3 py-[7px] rounded-md text-[12.5px] transition-all relative mt-3 mb-1',
            pathname === '/dashboard'
              ? 'agent-nav-link--active font-medium'
              : 'hover:bg-[var(--nav-hover)]',
          )}
          style={
            pathname === '/dashboard'
              ? { color: 'var(--nav-item-text-active)' }
              : { color: 'var(--nav-item-text)' }
          }
        >
          {pathname === '/dashboard' && (
            <span
              className="agent-nav-accent absolute left-0 top-[7px] bottom-[7px] w-[2.5px] rounded-full"
              style={{ background: '#FDB515' }}
            />
          )}
          <LayoutDashboard
            className={cn('h-[15px] w-[15px] shrink-0', pathname === '/dashboard' ? 'opacity-100' : 'opacity-55')}
          />
          <span className="flex-1 truncate">Dashboard</span>
        </Link>

        {NAV_GROUPS.map((group) => (
          <CollapsibleSection
            key={group.id}
            group={group}
            pathname={pathname}
            open={!!openGroups[group.id]}
            onToggle={() => toggle(group.id)}
          />
        ))}
      </div>

      {/* Bottom pinned section — never scrolls */}
      <div className="shrink-0 mt-auto">
        <UserMenu initialSession={initialSession} />
      </div>
    </aside>
  );
}

/** @deprecated Use UnifiedAgentSidebar instead */
export const StagingSidebar = UnifiedAgentSidebar;

function CollapsibleSection({
  group,
  pathname,
  open,
  onToggle,
}: {
  group: NavGroup;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  const hasActive = groupContainsPath(group, pathname);

  return (
    <div className="mb-0.5">
      <button
        onClick={onToggle}
        className={cn(
          'agent-nav-section w-full flex items-center justify-between px-3 pt-3.5 pb-1 text-[10px] uppercase tracking-[1px] font-semibold transition-colors',
          hasActive
            ? 'text-[var(--nav-item-text-active)]'
            : 'hover:text-[var(--nav-text)]',
        )}
        style={{ color: hasActive ? 'var(--nav-item-text-active)' : 'var(--nav-section-label)' }}
      >
        <span>{group.label}</span>
        <ChevronRight
          className={cn(
            'h-3 w-3 transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
      </button>

      {open && (
        <div>
          {group.items.map((item) => {
            const isParentActive = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <React.Fragment key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'agent-nav-link flex items-center gap-2 px-3 py-[7px] rounded-md text-[12.5px] transition-all relative',
                    isParentActive
                      ? 'agent-nav-link--active font-medium'
                      : 'hover:bg-[var(--nav-hover)]',
                  )}
                  style={isParentActive ? { color: 'var(--nav-item-text-active)' } : { color: 'var(--nav-item-text)' }}
                >
                  {isParentActive && (
                    <span
                      className="agent-nav-accent absolute left-0 top-[7px] bottom-[7px] w-[2.5px] rounded-full"
                      style={{ background: '#FDB515' }}
                    />
                  )}
                  {item.icon && (
                    <item.icon
                      className={cn('h-[15px] w-[15px] shrink-0', isParentActive ? 'opacity-100' : 'opacity-55')}
                    />
                  )}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge != null && (
                    <span
                      className={cn(
                        'ml-auto text-[10px] px-1.5 py-px rounded-full font-medium font-mono',
                        item.badgeVariant === 'warn'
                          ? 'bg-amber-500/[0.10] text-amber-600 dark:text-amber-400'
                          : 'bg-black/[0.06] dark:bg-white/[0.08] text-slate-500 dark:text-slate-400',
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>

                {isParentActive && item.children && (
                  <div className="pl-6 flex flex-col gap-0.5 mt-0.5 mb-1">
                    {item.children.map((child) => {
                      const isChildActive = child.exact
                        ? pathname === child.href
                        : pathname === child.href || pathname.startsWith(child.href + '/');
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            'agent-nav-link flex items-center gap-2 px-3 py-[5px] rounded-md text-[11.5px] transition-all relative',
                            isChildActive
                              ? 'agent-nav-link--active font-medium'
                              : 'hover:bg-[var(--nav-hover)]',
                          )}
                          style={isChildActive ? { color: 'var(--nav-item-text-active)' } : { color: 'var(--nav-item-text)' }}
                        >
                          {isChildActive && (
                            <span
                              className="agent-nav-accent absolute left-0 top-[5px] bottom-[5px] w-[2px] rounded-full"
                              style={{ background: '#FDB515' }}
                            />
                          )}
                          <span className="flex-1 truncate">{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
