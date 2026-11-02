import type { CSSProperties } from 'react';
import {
  Atom, BarChart3, BookOpen, Bot, Brain, CalendarClock, Code2, Compass, DatabaseZap, HeartHandshake,
  Layers, LifeBuoy, Lightbulb, Megaphone, Orbit, Package, Scale, ShieldCheck, Sparkles, TrendingUp,
  Users, Wallet, type LucideIcon,
} from 'lucide-react';

// Hues are mixed with --ink-1 / transparency at render time, so one value reads well in light and dark themes.
const HUE = {
  rose: '#F43F5E', emerald: '#10B981', sky: '#0EA5E9', amber: '#F59E0B', orange: '#F97316',
  pink: '#EC4899', teal: '#14B8A6', indigo: '#6366F1', cyan: '#06B6D4', violet: '#8B5CF6',
  slate: '#64748B', lime: '#84CC16',
} as const;

type Look = { icon: LucideIcon; hue: string };

// First match wins, so more specific domains come before generic ones (finance before sales' "account").
const RULES: Array<{ words: string[]; look: Look }> = [
  { words: ['hr', 'hrms', 'employee', 'people', 'workforce', 'talent', 'recruit', 'hiring', 'headcount', 'darwinbox', 'staff', 'attrition'], look: { icon: Users, hue: HUE.rose } },
  { words: ['finance', 'financial', 'revenue', 'invoice', 'billing', 'spend', 'budget', 'accounting', 'ledger', 'payment', 'expense', 'payroll'], look: { icon: Wallet, hue: HUE.emerald } },
  { words: ['security', 'compliance', 'audit', 'risk', 'fraud', 'governance', 'pii', 'access'], look: { icon: ShieldCheck, hue: HUE.indigo } },
  { words: ['support', 'ticket', 'incident', 'helpdesk', 'service desk', 'sla', 'escalation'], look: { icon: LifeBuoy, hue: HUE.amber } },
  { words: ['customer', 'churn', 'retention', 'nps', 'feedback', 'csat', 'onboarding'], look: { icon: HeartHandshake, hue: HUE.pink } },
  { words: ['sales', 'deal', 'crm', 'opportunit', 'lead', 'quota', 'salesforce', 'growth'], look: { icon: TrendingUp, hue: HUE.sky } },
  { words: ['marketing', 'campaign', 'seo', 'brand', 'advert', 'social'], look: { icon: Megaphone, hue: HUE.orange } },
  { words: ['inventory', 'supply', 'logistic', 'shipment', 'procurement', 'vendor', 'order', 'stock'], look: { icon: Package, hue: HUE.teal } },
  { words: ['legal', 'contract', 'clause', 'regulat'], look: { icon: Scale, hue: HUE.slate } },
  { words: ['quality', 'freshness', 'lineage', 'schema', 'etl', 'dbt', 'ingest', 'catalog', 'table', 'warehouse'], look: { icon: DatabaseZap, hue: HUE.cyan } },
  { words: ['code', 'engineer', 'deploy', 'devops', 'api', 'bug', 'sql'], look: { icon: Code2, hue: HUE.lime } },
  { words: ['schedule', 'calendar', 'meeting', 'shift', 'roster'], look: { icon: CalendarClock, hue: HUE.teal } },
  { words: ['doc', 'knowledge', 'faq', 'wiki', 'policy', 'handbook', 'research'], look: { icon: BookOpen, hue: HUE.violet } },
  { words: ['report', 'dashboard', 'kpi', 'metric', 'analytics', 'analyst', 'insight', 'forecast', 'trend'], look: { icon: BarChart3, hue: HUE.violet } },
];

const FALLBACK_ICONS: LucideIcon[] = [Bot, Sparkles, Compass, Lightbulb, Brain, Orbit, Atom, Layers];
const FALLBACK_HUES = [HUE.sky, HUE.violet, HUE.teal, HUE.indigo, HUE.emerald, HUE.pink, HUE.cyan, HUE.amber];

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = RULES.map(rule => ({ re: new RegExp(`\\b(${rule.words.map(escape).join('|')})`, 'i'), look: rule.look }));

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic icon + tint for an agent; the name is checked before the description so the title wins. */
export function agentLook(name: string, hint?: string | null): Look {
  for (const text of [name, hint ?? '']) {
    if (!text) continue;
    const hit = COMPILED.find(rule => rule.re.test(text));
    if (hit) return hit.look;
  }
  const h = hash(name.trim().toLowerCase() || 'agent');
  return { icon: FALLBACK_ICONS[h % FALLBACK_ICONS.length], hue: FALLBACK_HUES[(h >>> 8) % FALLBACK_HUES.length] };
}

const SIZES = {
  sm: { box: 'h-9 w-9 rounded-xl', icon: 'h-4 w-4' },
  md: { box: 'h-11 w-11 rounded-2xl', icon: 'h-5 w-5' },
  lg: { box: 'h-14 w-14 rounded-2xl', icon: 'h-6 w-6' },
} as const;

export function AgentAvatar({ name, hint, size = 'sm', className = '' }: {
  name: string;
  hint?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { icon: Icon, hue } = agentLook(name, hint);
  const s = SIZES[size];
  const style: CSSProperties = {
    background: `color-mix(in srgb, ${hue} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${hue} 24%, transparent)`,
    color: `color-mix(in srgb, ${hue} 72%, var(--ink-1))`,
  };
  return (
    <span className={`flex shrink-0 items-center justify-center ${s.box} ${className}`} style={style} aria-hidden>
      <Icon className={s.icon} strokeWidth={1.9} />
    </span>
  );
}
