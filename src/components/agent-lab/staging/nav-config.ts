import {
  HouseIcon, HammerIcon, BrainIcon, StackIcon, ShieldCheckIcon,
  MagnifyingGlassIcon, SquaresFourIcon, RulerIcon, MagicWandIcon, FlaskIcon,
  DiceFiveIcon, ClockCounterClockwiseIcon, LightbulbIcon, PulseIcon, UsersThreeIcon,
  UsersIcon, ScrollIcon, BookOpenIcon, BooksIcon, CubeIcon, TreeStructureIcon,
  LightningIcon, PathIcon, HardDrivesIcon,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { ESTATE_NAV_ITEMS } from '@/lib/estate/nav-items';

export interface NavItem {
  label: string;
  href: string;
  icon: PhosphorIcon;
  exact?: boolean;
}

export interface NavGroup {
  /** Full name — panel title. */
  label: string;
  /** Short name — rail label (must fit ~7 characters). */
  railLabel: string;
  description: string;
  id: string;
  icon: PhosphorIcon;
  items: NavItem[];
}

/** Sidebar icons for the estate pages (the in-page EstateNav keeps its own icon set). */
const ESTATE_ICONS: Record<string, PhosphorIcon> = {
  '/agent-lab/estate': SquaresFourIcon,
  '/agent-lab/estate/catalog': BooksIcon,
  '/agent-lab/estate/entities': CubeIcon,
  '/agent-lab/estate/lineage': TreeStructureIcon,
  '/agent-lab/estate/jobs': LightningIcon,
  '/agent-lab/estate/mapper': PathIcon,
  '/agent-lab/estate/silo': HardDrivesIcon,
};

export const HOME_ITEM: NavItem = { label: 'Home', href: '/dashboard', icon: HouseIcon, exact: true };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Build',
    railLabel: 'Build',
    description: 'Inspect, teach and tune agents',
    id: 'build',
    icon: HammerIcon,
    items: [
      { label: 'Inspector',       href: '/inspector',            icon: MagnifyingGlassIcon },
      { label: 'Workbench',       href: '/agent-lab/workbench',    icon: HammerIcon },
      { label: 'Dashboards',      href: '/inspector/dashboards', icon: SquaresFourIcon },
      { label: 'Metrics',         href: '/agent-lab/metrics',    icon: RulerIcon },
      { label: 'Teach',           href: '/agent-lab/teach',      icon: MagicWandIcon },
      { label: 'Performance Lab', href: '/performance-lab',      icon: FlaskIcon },
      { label: 'Bandits',         href: '/agent-lab/bandits',    icon: DiceFiveIcon },
      { label: 'History',         href: '/agent-lab/history',    icon: ClockCounterClockwiseIcon },
      { label: 'Prompts',         href: '/agent-lab/ops/prompts', icon: ScrollIcon },
      { label: 'Evals',           href: '/agent-lab/ops/evals',  icon: FlaskIcon },
    ],
  },
  {
    label: 'Memory',
    railLabel: 'Memory',
    description: 'What your agents have learned',
    id: 'memory',
    icon: BrainIcon,
    items: [
      { label: 'FOER',          href: '/agent-lab/memory',               icon: LightbulbIcon, exact: true },
      { label: 'FOER Ops',      href: '/agent-lab/memory/ops',           icon: PulseIcon },
      { label: 'Contributions', href: '/agent-lab/memory/contributions', icon: UsersThreeIcon },
    ],
  },
  {
    label: 'Data Estate',
    railLabel: 'Estate',
    description: 'Catalog, lineage and jobs',
    id: 'estate',
    icon: StackIcon,
    // Labels/hrefs come from the single source of truth shared with the in-page
    // tab bar (EstateNav) so the two can't drift.
    items: ESTATE_NAV_ITEMS.map((it) => ({
      label: it.label,
      href: it.href,
      icon: ESTATE_ICONS[it.href] ?? StackIcon,
      exact: it.match === 'exact',
    })),
  },
  {
    label: 'Govern',
    railLabel: 'Govern',
    description: 'People, policies and audit',
    id: 'govern',
    icon: ShieldCheckIcon,
    items: [
      { label: 'Users',     href: '/agent-staging/users',    icon: UsersIcon },
      { label: 'Policies',  href: '/agent-staging/policies', icon: ShieldCheckIcon },
      { label: 'Audit Log', href: '/agent-staging/audit',    icon: ScrollIcon },
      { label: 'Docs',      href: '/docs',                   icon: BookOpenIcon },
    ],
  },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + '/');
}

export function groupForPath(pathname: string): string {
  return NAV_GROUPS.find((g) => g.items.some((i) => isActive(i, pathname)))?.id ?? NAV_GROUPS[0].id;
}
