import {
  Anchor, Atom, Award, BarChart3, BookOpen, BookUser, Bot, Brain, CalendarClock, Code2, Compass, DatabaseZap,
  GraduationCap, HardHat, HeartHandshake, HeartPulse, Layers, Leaf, LifeBuoy, Lightbulb, Megaphone, Orbit,
  Package, ReceiptText, Scale, Ship, ShieldCheck, Sparkles, TrendingUp, UsersRound, Wallet, Wrench,
  type LucideIcon,
} from 'lucide-react';

type Look = { icon: LucideIcon };

// First match wins, so the most specific concept comes first: what the agent *does* (appraise, keep records,
// buy) beats who it serves (crew, HR), which beats generic analytics. Words are prefix-matched at a word start.
const RULES: Array<{ words: string[]; look: Look }> = [
  { words: ['appraisal', 'performance review', 'evaluation', 'scorecard', 'promotion'], look: { icon: Award } },
  { words: ['record', 'certificate', 'certification', 'licence', 'license', 'passport', 'visa', 'registry', 'dossier'], look: { icon: BookUser } },
  { words: ['training', 'course', 'competenc', 'learning', 'cbt', 'stcw'], look: { icon: GraduationCap } },
  { words: ['safety', 'hse', 'hseq', 'accident', 'near miss', 'injury', 'hazard', 'ltif', 'casualty'], look: { icon: HardHat } },
  { words: ['medical', 'health', 'fatigue', 'wellbeing', 'well-being', 'rest hour'], look: { icon: HeartPulse } },
  { words: ['purchase', 'procurement', 'requisition', 'vendor', 'supplier', 'sourcing'], look: { icon: ReceiptText } },
  { words: ['emission', 'carbon', 'cii', 'eexi', 'decarbon', 'esg', 'sustainab', 'fuel', 'bunker'], look: { icon: Leaf } },
  { words: ['maintenance', 'machinery', 'engine', 'spare', 'repair', 'technical', 'pms', 'dry dock', 'drydock'], look: { icon: Wrench } },
  { words: ['sire', 'vetting', 'ocimf', 'rightship', 'port state', 'psc', 'vessel', 'ship', 'fleet', 'voyage', 'tanker', 'charter', 'marine', 'maritime'], look: { icon: Ship } },
  { words: ['seafarer', 'crew', 'mariner', 'manning', 'sailor', 'cadet'], look: { icon: Anchor } },
  { words: ['hr', 'hrms', 'employee', 'people', 'workforce', 'talent', 'recruit', 'hiring', 'headcount', 'darwinbox', 'staff', 'attrition'], look: { icon: UsersRound } },
  { words: ['finance', 'financial', 'revenue', 'invoice', 'billing', 'spend', 'budget', 'accounting', 'ledger', 'payment', 'expense', 'payroll'], look: { icon: Wallet } },
  { words: ['security', 'compliance', 'audit', 'risk', 'fraud', 'governance', 'pii', 'access'], look: { icon: ShieldCheck } },
  { words: ['support', 'ticket', 'incident', 'helpdesk', 'service desk', 'sla', 'escalation'], look: { icon: LifeBuoy } },
  { words: ['customer', 'churn', 'retention', 'nps', 'feedback', 'csat', 'onboarding'], look: { icon: HeartHandshake } },
  { words: ['sales', 'deal', 'crm', 'opportunit', 'lead', 'quota', 'salesforce', 'growth'], look: { icon: TrendingUp } },
  { words: ['marketing', 'campaign', 'seo', 'brand', 'advert', 'social'], look: { icon: Megaphone } },
  { words: ['inventory', 'supply', 'logistic', 'shipment', 'order', 'stock', 'warehouse stock'], look: { icon: Package } },
  { words: ['legal', 'contract', 'clause', 'regulat'], look: { icon: Scale } },
  { words: ['quality', 'freshness', 'lineage', 'schema', 'etl', 'dbt', 'ingest', 'catalog', 'table', 'warehouse'], look: { icon: DatabaseZap } },
  { words: ['code', 'engineer', 'deploy', 'devops', 'api', 'bug', 'sql'], look: { icon: Code2 } },
  { words: ['schedule', 'calendar', 'meeting', 'shift', 'roster'], look: { icon: CalendarClock } },
  { words: ['doc', 'knowledge', 'faq', 'wiki', 'policy', 'handbook', 'research'], look: { icon: BookOpen } },
  { words: ['report', 'dashboard', 'kpi', 'metric', 'analytics', 'analyst', 'insight', 'forecast', 'trend'], look: { icon: BarChart3 } },
];

const FALLBACK_ICONS: LucideIcon[] = [Bot, Sparkles, Compass, Lightbulb, Brain, Orbit, Atom, Layers];

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = RULES.map(rule => ({ re: new RegExp(`\\b(${rule.words.map(escape).join('|')})`, 'i'), look: rule.look }));

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic icon for an agent; the name is checked before the description so the title wins. */
export function agentLook(name: string, hint?: string | null): Look {
  for (const text of [name, hint ?? '']) {
    if (!text) continue;
    const hit = COMPILED.find(rule => rule.re.test(text));
    if (hit) return hit.look;
  }
  const h = hash(name.trim().toLowerCase() || 'agent');
  return { icon: FALLBACK_ICONS[h % FALLBACK_ICONS.length] };
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
  const { icon: Icon } = agentLook(name, hint);
  const s = SIZES[size];
  return (
    <span className={`flex shrink-0 items-center justify-center border border-[var(--line-1)] bg-[var(--surface-2)] text-[var(--ink-2)] ${s.box} ${className}`} aria-hidden>
      <Icon className={s.icon} strokeWidth={1.9} />
    </span>
  );
}
