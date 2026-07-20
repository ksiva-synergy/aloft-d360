import {
  Layers, BookOpen, Boxes, GitBranch, Zap, Route, Server,
} from 'lucide-react';
import type { ElementType } from 'react';

/**
 * Single source of truth for the Data Estate navigation.
 *
 * Consumed by BOTH the sidebar Data Estate group
 * ([UnifiedAgentSidebar](../../components/agent-lab/staging/StagingSidebar.tsx))
 * and the in-page tab bar
 * ([EstateNav](../../app/(agent)/agent-lab/estate/EstateNav.tsx)).
 *
 * Before this existed the two lists drifted — the sidebar showed 5 items while
 * the tab bar showed 7 (Entities + Lineage were reachable only via the tab bar).
 * Keep them here so they can never diverge again.
 *
 * `match` drives active-state resolution: 'exact' matches only the exact path;
 * 'prefix' also matches deeper routes (e.g. Jobs stays active on /jobs/[id]).
 */
export interface EstateNavItem {
  label: string;
  href: string;
  icon: ElementType;
  match: 'exact' | 'prefix';
}

export const ESTATE_NAV_ITEMS: EstateNavItem[] = [
  { label: 'Overview',    href: '/agent-lab/estate',          icon: Layers,    match: 'exact' },
  { label: 'Catalog',     href: '/agent-lab/estate/catalog',  icon: BookOpen,  match: 'prefix' },
  { label: 'Entities',    href: '/agent-lab/estate/entities', icon: Boxes,     match: 'prefix' },
  { label: 'Lineage',     href: '/agent-lab/estate/lineage',  icon: GitBranch, match: 'prefix' },
  { label: 'Jobs',        href: '/agent-lab/estate/jobs',     icon: Zap,       match: 'prefix' },
  { label: 'Mapper',      href: '/agent-lab/estate/mapper',   icon: Route,     match: 'prefix' },
  { label: 'Silo Finder', href: '/agent-lab/estate/silo',     icon: Server,    match: 'prefix' },
];

/** True when `pathname` should mark `item` active, per its match mode. */
export function isEstateItemActive(item: EstateNavItem, pathname: string): boolean {
  return item.match === 'exact'
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + '/');
}
