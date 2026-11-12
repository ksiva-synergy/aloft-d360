import type { AccessPrincipal } from '@/lib/access/types';
import { getWelcomeBase } from './welcome-cache';
import { scoreObjectForDomain, type WelcomeObject } from './welcome-catalog';
import {
  displayDepartmentName,
  resolveObjectDepartmentKey,
} from './welcome-departments';

const DOMAIN_SCOPE_NOTES: Record<string, string> = {
  hr: 'corporate / shore-office employee HRIS data (Darwinbox employee master, offices, divisions, functional areas, reporting lines, and payroll vs costing lines) — distinct from vessel **Crewing** / seafarer sign-on data',
  crewing:
    'vessel seafarer manning and crewing operations (seafarer profiles, vessel sign-on/off, relief planning, STCW certificates, appraisals, and portage bill wages) — distinct from shore-office **HR**',
  marine:
    'vessel voyages, port calls and itineraries, noon and fuel consumption logs, remaining on board (ROB) stocks, and fleet operational performance',
  technical:
    'ship planned maintenance (PMS) jobs, vessel and machinery defect reports, component running hours, and onboard spare part stock',
  qhse: 'maritime safety and quality (SIRE, PSC, and vetting inspections, Lost Time Injuries / LTI, near-miss reports, and corrective action plans)',
  finance:
    'vessel operating budgets and expenses, EBITDA by segment, company income/expense journals, supplier invoices, and cash management transfers',
  explore: 'cross-functional maritime datasets (flag and visa planning, environmental and bilge logs, and market snapshots)',
};

const EXPLICIT_DOMAIN_PATTERNS: Array<[RegExp, string]> = [
  [/^\s*in\s+hr\b|\bour\s+hr\s+data\b|\bhr\s+(?:data|domain|area|briefing|headcount|roster)\b|\b(?:human\s+resources|darwin\s*box|darwin_box|shore[- ]office\s+employees?|shore\s+employees?)\b/i, 'hr'],
  [/^\s*in\s+crewing\b|\bour\s+crewing\s+data\b|\bcrewing\s+(?:data|domain|area|briefing)\b/i, 'crewing'],
  [/^\s*in\s+marine\b|\bour\s+marine\s+data\b|\bmarine\s+(?:data|domain|area|briefing)\b/i, 'marine'],
  [/^\s*in\s+technical\b|\bour\s+technical\s+data\b|\btechnical\s+(?:data|domain|area|briefing)\b/i, 'technical'],
  [/^\s*in\s+qhse\b|\bour\s+qhse\s+data\b|\bqhse\b/i, 'qhse'],
  [/^\s*in\s+finance\b|\bour\s+finance\s+data\b|\bfinance\s+(?:data|domain|area|briefing)\b/i, 'finance'],
  [/^\s*in\s+more\s+to\s+explore\b|\bour\s+more\s+to\s+explore\s+data\b/i, 'explore'],
];

const KNOWN_DOMAIN_KEYS = new Set(['crewing', 'marine', 'technical', 'qhse', 'finance', 'hr', 'explore']);

export function detectDomainKeyFromText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  for (const [re, key] of EXPLICIT_DOMAIN_PATTERNS) {
    if (re.test(t)) return key;
  }
  return null;
}

export function resolveSessionDomainKey(input: {
  explicitDomainKey?: string | null;
  messages?: Array<{ role: string; content?: string }>;
}): string | null {
  const userTexts = (input.messages ?? [])
    .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim())
    .map((m) => m.content!.trim());

  // 1. Latest user message wins if it explicitly names a domain.
  if (userTexts.length > 0) {
    const fromLatest = detectDomainKeyFromText(userTexts[userTexts.length - 1]);
    if (fromLatest) return fromLatest;
  }

  // 2. Explicit domain key passed from the Welcome drill-in selection.
  const explicit = input.explicitDomainKey?.trim().toLowerCase();
  if (explicit && KNOWN_DOMAIN_KEYS.has(explicit)) return explicit;

  // 3. Earlier user messages in the same session (e.g. follow-up after a domain starter).
  for (let i = userTexts.length - 2; i >= 0; i--) {
    const found = detectDomainKeyFromText(userTexts[i]);
    if (found) return found;
  }

  return null;
}

function isRedundantLegacyVariant(path: string, allPaths: Set<string>): boolean {
  const lower = path.toLowerCase();
  const stripped = lower.replace(/_(old|bkp.*)$/, '');
  if (stripped !== lower && allPaths.has(stripped)) return true;
  if (lower.includes('.old_lzdev_')) {
    const canonical = lower.replace('.old_lzdev_', '.');
    if (allPaths.has(canonical)) return true;
  }
  return false;
}

export async function buildDomainFocusContext(input: {
  orgId: string;
  dataPrincipal?: AccessPrincipal | null;
  domainKey?: string | null;
  messages?: Array<{ role: string; content?: string }>;
}): Promise<string> {
  const targetDomain = resolveSessionDomainKey({
    explicitDomainKey: input.domainKey,
    messages: input.messages,
  });
  if (!targetDomain) return '';

  try {
    const base = await getWelcomeBase(input.orgId);
    const departments = base.departments;
    const domainEntries = base.objects.filter(
      (o) => resolveObjectDepartmentKey(o.full_path, departments) === targetDomain,
    );
    if (domainEntries.length === 0) return '';

    const allPaths = new Set(domainEntries.map((o) => o.full_path.toLowerCase()));
    const scored = domainEntries
      .filter((o) => !isRedundantLegacyVariant(o.full_path, allPaths))
      .map((o) => {
        const wObj: WelcomeObject = o.welcome;
        return {
          ...wObj,
          score: scoreObjectForDomain(wObj),
        };
      })
      .sort((a, b) => b.score - a.score || (b.row_count_est ?? 0) - (a.row_count_est ?? 0));

    const top = scored.slice(0, 8);
    if (top.length === 0) return '';

    const deptName = departments.find((d) => d.key === targetDomain)?.name;
    const label = displayDepartmentName(targetDomain, deptName);
    const scopeNote = DOMAIN_SCOPE_NOTES[targetDomain] ?? `datasets grouped under the **${label}** business area`;

    const lines = top.map((o) => {
      const rows = o.row_count_est != null && o.row_count_est > 0 ? `, ~${o.row_count_est.toLocaleString('en-US')} rows` : '';
      const entity = o.semantic?.entity ? `entity: ${o.semantic.entity}${rows}` : rows.replace(/^,\s*/, '');
      const meta = entity ? ` (${entity})` : '';
      const summary = o.semantic?.summary ? ` — ${o.semantic.summary.slice(0, 220)}` : '';
      const intents =
        o.semantic?.intents && o.semantic.intents.length > 0
          ? ` | Intents: ${o.semantic.intents.slice(0, 3).join('; ')}`
          : '';
      return `- \`${o.full_path}\`${meta}${summary}${intents}`;
    });

    return [
      `## DOMAIN FOCUS — ${label} (Starting Path)`,
      `The user selected or asked about the **${label}** area: ${scopeNote}.`,
      `Representative **${label}** datasets confirmed in the catalog (${domainEntries.length} total in this area):`,
      ...lines,
      '',
      `**How to use this starting path (soft scope, NOT a hard restriction):**`,
      `- Ground your answer or **${label}** briefing in the datasets above first. To inspect columns before running SQL, call \`describe_schema\` with \`action:'describe'\` on the best-matching path above (or \`action:'search'\` if you need other tables).`,
      `- Do **not** conflate **${label}** with other areas (for example, keep shore-office **HR** in Darwinbox separate from vessel **Crewing** / seafarer sign-on data) unless the user asks to combine or compare them.`,
      `- In your user-facing reply, still use plain business language only (never print raw \`catalog.schema.table\` paths unless asked).`,
      `- Other business areas remain fully accessible if the user's question or follow-up crosses areas.`,
      `- If the user lacks access to a path, they may request access; do not refuse the question solely because of discover scope.`,
    ].join('\n');
  } catch (err) {
    console.warn('[inspector/domain-context] failed to build domain focus (non-fatal):', err);
    return '';
  }
}
