/**
 * Groups visible harvested objects into business domains for the Inspector welcome.
 */

import type { ParsedObjectSemantic } from './welcome-semantics';
import {
  displayDepartmentName,
  resolveObjectDepartmentKey,
  sortDepartmentKeys,
  type WelcomeDepartmentDef,
} from './welcome-departments';

export interface WelcomeObject {
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  domain_keywords: string[];
  last_t0_at: Date | null;
  row_count_est?: number | null;
  has_t3?: boolean;
  semantic?: ParsedObjectSemantic;
}

export interface WelcomeOffer {
  label: string;
  prompt: string;
  /** Optional sub-area pill label inside the domain (e.g. "Manning & Reliefs"). */
  topic?: string;
}

export interface WelcomeSubtopic {
  key: string;
  label: string;
  count: number;
}

export interface WelcomeArea {
  /** Business domain key (crewing, marine, finance, …). */
  key: string;
  label: string;
  tableCount: number;
  topics: string[];
  tagline: string;
  covers: string[];
  offers: WelcomeOffer[];
  /** Sub-area filter pills derived from actual datasets/intents in this domain. */
  subtopics?: WelcomeSubtopic[];
}

export interface WelcomeCatalog {
  totalTables: number;
  totalAreas: number;
  lastRefreshedAt: string | null;
  areas: WelcomeArea[];
}

/** Coerce partial API / stale JSON so the welcome UI never reads undefined.length. */
export function normalizeWelcomeCatalog(raw: Partial<WelcomeCatalog> | null | undefined): WelcomeCatalog {
  const areas = (raw?.areas ?? []).map((a) => ({
    key: a.key ?? '',
    label: a.label ?? a.key ?? 'Domain',
    tableCount: a.tableCount ?? 0,
    topics: a.topics ?? [],
    tagline: a.tagline ?? '',
    covers: a.covers ?? [],
    offers: a.offers ?? [],
    subtopics: a.subtopics ?? [],
  })).filter((a) => a.key);
  return {
    totalTables: raw?.totalTables ?? areas.reduce((n, a) => n + a.tableCount, 0),
    totalAreas: raw?.totalAreas ?? areas.length,
    lastRefreshedAt: raw?.lastRefreshedAt ?? null,
    areas,
  };
}

export interface BuildWelcomeOptions {
  departments?: WelcomeDepartmentDef[];
  maxAreas?: number;
}

function capWord(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const WAREHOUSE_TOKENS =
  /curated_db|open_analytics|reporting_layer|landing_zone|navitasai|db_smac|synergymarine/i;

/** Drop copy that looks like a warehouse path, schema, or table name — welcome is stakeholder-facing. */
export function isStakeholderFacingLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (WAREHOUSE_TOKENS.test(t)) return false;
  if (/\b[a-z0-9_-]+\.[a-z0-9_.-]+(?:\.[a-z0-9_.-]+)?\b/i.test(t)) return false;
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/i.test(t)) return false;
  return true;
}

export function scrubStakeholderLine(text: string): string {
  let t = text
    .replace(/\b[a-z0-9_-]+\.[a-z0-9_.-]+(?:\.[a-z0-9_.-]+)?\b/gi, '')
    .replace(/\b(table|view|schema|catalog)\s+[a-z0-9_.-]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.endsWith(',') || t.endsWith('.')) t = t.slice(0, -1).trim();
  return t;
}

function stakeholderTopic(keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (k.length < 3) return false;
  if (!isStakeholderFacingLine(k)) return false;
  if (/_gold$|_silver$|_bronze$|_public$|_prod$/.test(k)) return false;
  return true;
}

export function areaTagline(label: string, topics: string[], key?: string): string {
  if (key && DOMAIN_TAGLINES[key]) return DOMAIN_TAGLINES[key];
  if (topics.length >= 2) {
    return `Questions about ${topics.slice(0, 3).map(capWord).join(', ')}.`;
  }
  if (topics.length === 1) return `Questions about ${capWord(topics[0])}.`;
  return `Explore metrics and trends in ${label}.`;
}

const DOMAIN_TAGLINES: Record<string, string> = {
  crewing:
    'Seafarer profiles, vessel sign-on and relief planning, appraisals, STCW certificates, and portage bill wages.',
  marine:
    'Vessel voyages, port calls and itineraries, fuel consumption and ROB logs, and fleet operational performance.',
  technical:
    'Planned maintenance (PMS) jobs, vessel and machinery defect reports, running hours, and onboard spare part stock.',
  qhse:
    'SIRE, PSC, and vetting inspections, Lost Time Injuries (LTI), near-miss reports, and corrective action plans.',
  finance:
    'Vessel operating budgets and expenses, EBITDA by segment, company P&L journals, supplier invoices, and cash transfers.',
  hr:
    'Shore-office employee roster, org hierarchy and reporting lines, office and division headcount, and payroll vs costing lines.',
  explore:
    'Cross-functional datasets including flag and visa planning, environmental and bilge logs, and market snapshots.',
};

const TECHNICAL_INTENT_NOISE_RE =
  /\b(inspect\b|schema\b|metadata\b|column\s+names?|available\s+columns|sample\s+(data|records|rows)|fivetran|scd\b|sentinel|lineages?\b|cdc\b|ingest(ion|ed)?\b|downstream\s+(processing|reporting|joins?)|dropdown|resolve\s+.*\bby\s+(code|id)\b|lookup\s+.*\bby\s+(code|id)\b|keep\s+rank-?1|null[- ]rate|null\s+records?|reconciliation|non-?null|soft[- ]deleted|non-deleted|surrogate|uuid|binary\b|unnest\b|dedupe\b|deduplicate\b|staging\b|etl\b|adf\b|nmea\b|kafka\b|scraper?\b|playwright|api\s+(call|failure)|http\s+response|lockout|password\s+hash|2fa|asp\.net|oidc|identityserver|rescued\s+data|auto\s*loader|odq\b|mandt\b|active[- ]flag|catalogued\s+rows|synced\s+rows|connector\s+ingest|projection\s+of\s+all|filter\s+.*\bby\s+schema\b|for\s+integration\s+checks|join\s+on\b|deprecated\b|rows\s+with\s+a\b|\bph5\b|\bph6\b|\bph\s+snapshots?\b|\bv3\b|\bv11\b)\b/i;

const NON_QUESTION_PREFIX_RE =
  /^(join\b|unnest\b|inspect\b|verify\b|check\s+(schema|active|soft|scd|null|if|for\s+non-current)\b|full\s+(table\s+)?(scan|snapshot|extract|for\s+downstream)|extract\s+.*\bfor\s+downstream\b)/i;

/**
 * Score how well an object represents its business domain for welcome suggestions
 * and starting context (prefers T3-queried, curated/reporting, populated tables
 * over tiny Fivetran lookup tables or _old/_bkp snapshots).
 */
export function scoreObjectForDomain(o: Pick<WelcomeObject, 'full_path' | 'object_name' | 'row_count_est' | 'has_t3' | 'semantic'>): number {
  if (!o.semantic) return 0;
  let s = 2;
  if (o.has_t3) s += 5;
  const rows = Number(o.row_count_est ?? 0);
  if (rows >= 5000) s += 4;
  else if (rows >= 500) s += 3;
  else if (rows >= 100) s += 1;
  else if (rows > 0 && rows < 50) s -= 3;

  const path = o.full_path.toLowerCase();
  if (/(^|\.)(curated_db|curated_zone|reporting_layer)(\.|$)/.test(path)) s += 3;
  if (/(^|\.)(landing_zone|landing_zone_dev)(\.|$)/.test(path)) s -= 2;
  if (path.includes('scratchpad') || path.includes('data360_dev')) s -= 2;
  if (
    /(^|_|\.)(old|bkp|backup|test|testrun|tmp|stg|staging|smartpal_log|gpt_payload|freshness_snapshot|dcp_|powerbi_|scraper_|nyctaxi|trips|extra_email)($|_|\.)/i.test(
      path,
    )
  ) {
    s -= 6;
  }
  if (/masters_crewing|masters_public|masters_document|idp_public|nyctaxi|vessel_portal/i.test(path)) {
    s -= 4;
  }
  const entity = (o.semantic.entity ?? '').toLowerCase();
  if (/(^|_)(link|mapping|checklist|log|token|attachment|file|audit_event)($|_)/.test(entity)) {
    s -= 3;
  }
  return Math.max(0.2, s);
}

function scoreBusinessIntent(raw: string, objWeight: number): number {
  const line = scrubStakeholderLine(raw);
  if (!line || !isStakeholderFacingLine(line)) return -1;
  if (line.length < 14 || line.split(/\s+/).length < 3) return -1;
  if (TECHNICAL_INTENT_NOISE_RE.test(line) || NON_QUESTION_PREFIX_RE.test(line)) return -1;

  let s = objWeight;
  if (
    /\b(summari[sz]e|analy[sz]e|count|compare|breakdown|trend|overdue|open\s+|total|headcount|completion|distribution|per\s+vessel|by\s+(office|division|vessel|rank|type|status|month|company|department|flag|severity|category|account))\b/i.test(
      line,
    )
  ) {
    s += 3;
  }
  if (
    /\b(for\s+a\s+(specific|given|single)|by\s+(crew\s*code|crew\s*id|imo\s+number|employee\s+id|plan\s+number|agreement\s+number|job\s+report)|specific\s+(seafarer|cadet|vessel|defect|job|record|supplier|port)|^(lookup|look\s+up|resolve)\b)\b/i.test(
      line,
    )
  ) {
    s -= 4;
  }
  return s;
}

const INTENT_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'per', 'all', 'by', 'in', 'on', 'of', 'to', 'a', 'an', 'or',
  'list', 'count', 'summarise', 'summarize', 'analyse', 'analyze', 'retrieve', 'filter', 'show',
  'get', 'find', 'lookup', 'look', 'up', 'active', 'current', 'total', 'records', 'rows', 'data',
  'view', 'table',
]);

function intentContentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !INTENT_STOPWORDS.has(w)),
  );
}

type WordCache = Map<string, Set<string>>;

/** Memoized per selection pass — the greedy loop compares the same intents thousands of times. */
function cachedContentWords(cache: WordCache, s: string): Set<string> {
  let words = cache.get(s);
  if (!words) {
    words = intentContentWords(s);
    cache.set(s, words);
  }
  return words;
}

function intentsTooSimilar(a: string, b: string, cache?: WordCache): boolean {
  const wa = cache ? cachedContentWords(cache, a) : intentContentWords(a);
  const wb = cache ? cachedContentWords(cache, b) : intentContentWords(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap += 1;
  return overlap / Math.min(wa.size, wb.size) >= 0.6;
}

type IntentCandidate = { intent: string; entity: string; topic: string; baseScore: number };

const DOMAIN_SUBTOPIC_RULES: Record<string, Array<{ label: string; re: RegExp }>> = {
  crewing: [
    { label: 'Manning & Reliefs', re: /sail|sign[-_ ]?on|sign[-_ ]?off|relief|reliever|planner|crew_change|manning|assignment|availability|on[-_ ]?signer|coordinator|movement|roster/i },
    { label: 'Contracts & Pay', re: /portage|wage|earning|deduction|allotment|cash_advance|bond|welfare|cba|contract|payroll|budget|invoice|purchase_order/i },
    { label: 'Competency & Certificates', re: /appraisal|cadet|training|competenc|certificate|stcw|promotion|score|feedback|evaluation/i },
    { label: 'Seafarer Profiles', re: /seafarer|sea_experience|profile|nationality|family|bank|wellbeing/i },
  ],
  marine: [
    { label: 'Fuel & Consumption', re: /fuel|bunker|rob\b|consumption|fresh_water|cii|emission|lube|enerva/i },
    { label: 'Voyages & Port Calls', re: /port_call|itinerary|arrival|eta|voyage|routing|position_book|journal/i },
    { label: 'Certificates & Surveys', re: /cert|survey|class|coc\b|psc\b|deficienc/i },
    { label: 'Fleet Performance', re: /work_order|scorecard|deferred|larp|performance|speed|fleet|ihs|holding|snapshot/i },
  ],
  technical: [
    { label: 'Spares & Stock', re: /spare|inv_|stock|rob\b|manufacturer|component|mounting|rfq|purchase/i },
    { label: 'Defects & Root Cause', re: /defect|machinery_defect|root_cause|indirect_cause|corrective|preventive|capa|deficiency|accident|evidence|property_loss/i },
    { label: 'Planned Maintenance (PMS)', re: /pms|work_order|work_plan|reported_job|ce_job|counter|running_hour|lar\b|delegate|delegation/i },
    { label: 'Audits & Inspections', re: /audit|auditee|evaluation|inspection|improvement/i },
  ],
  qhse: [
    { label: 'Findings & CAPA', re: /finding|corrective|improvement|non_?conform|nc\b|nc2|observation|area_of_concern/i },
    { label: 'Inspections & Vetting', re: /vetting|sire|psc|tokyo_mou|inspection|vir_|detention|audit|port/i },
    { label: 'Incidents & Near Misses', re: /lti|incident|near_?miss|injury|potential_incident|consequence/i },
    { label: 'Safety Critical', re: /safety_critical|critical_spare|buss_critical|movement/i },
  ],
  finance: [
    { label: 'EBITDA & P&L', re: /ebitda|income_expense|p&l|profit|revenue|segment|onboard|owner_group/i },
    { label: 'Budgets & OPEX', re: /budget|opex|expense|prediction|accuracy|schedule|sap_tech/i },
    { label: 'Payables & Committed Cost', re: /invoice|committed_cost|supplier|statement_of_account|voucher|shipnet_payment|po\b/i },
    { label: 'Payroll & Cash', re: /benefit|welfare|cash|transfer|earning|portage|allotment|chat_card|bond|overtime|elimination/i },
  ],
  hr: [
    { label: 'Headcount & Offices', re: /headcount|office|country|company|division|functional/i },
    { label: 'Payroll & Costing', re: /payroll|costing|budget/i },
    { label: 'Org & Reporting Lines', re: /manager|rollup|hierarchy|designation|role|rank|department|email/i },
    { label: 'Tenure & Audit Changes', re: /retirement|confirmation|audit|change|login|tenure|exit/i },
  ],
  explore: [
    { label: 'Visas & Flag Documents', re: /visa|cra\b|flag|seafarer|cadet|debrief/i },
    { label: 'Environment & Emissions', re: /environment|bilge|garbage|sox|cii|bunker|consumption/i },
    { label: 'Procurement & Spares', re: /purchase|requisition|pr\b|po\b|spare|bom\b|vendor|qtc|manufacturer/i },
    { label: 'Fleet & Operations', re: /vessel|snapshot|machinery|work_order|mms|deferment|schedule|improvement|corrective|preventive|survey|inspection/i },
  ],
};

function classifySubtopic(domainKey: string, entity: string, intent: string, fullPath: string): string {
  const rules = DOMAIN_SUBTOPIC_RULES[domainKey];
  // Match intent + entity first so specific wording ("fuel consumption", "spare item") beats broad schema names.
  const primaryText = `${intent} ${entity}`;
  if (rules) {
    for (const r of rules) {
      if (r.re.test(primaryText)) return r.label;
    }
    for (const r of rules) {
      if (r.re.test(fullPath)) return r.label;
    }
    return rules[rules.length - 1].label;
  }
  const cleanEntity = entity
    .replace(/_/g, ' ')
    .replace(/\b(view|table|record|entry|line|item|log|data|master|snapshot)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanEntity ? capWord(cleanEntity) : 'General';
}

type SemAcc = {
  entities: Map<string, number>;
  intents: Map<string, number>;
  candidates: IntentCandidate[];
  summaries: string[];
  /** Lower-cased summaries already in `summaries` (O(1) de-dup). */
  summaryKeys?: Set<string>;
};

function ingestSemantic(acc: SemAcc, o: WelcomeObject, deptKey: string): void {
  const semantic = o.semantic;
  if (!semantic) return;
  const weight = scoreObjectForDomain(o);
  if (semantic.entity) {
    acc.entities.set(semantic.entity, (acc.entities.get(semantic.entity) ?? 0) + weight);
  }
  const entityKey = (semantic.entity ?? o.object_name ?? '').toLowerCase();
  for (const intent of semantic.intents) {
    acc.intents.set(intent, (acc.intents.get(intent) ?? 0) + weight);
    const sc = scoreBusinessIntent(intent, weight);
    if (sc > 0) {
      const cleanIntent = scrubStakeholderLine(intent);
      const topic = classifySubtopic(deptKey, entityKey, cleanIntent, o.full_path);
      acc.candidates.push({ intent: cleanIntent, entity: entityKey, topic, baseScore: sc });
    }
  }
  if (semantic.summary) {
    const key = semantic.summary.toLowerCase();
    const seen = (acc.summaryKeys ??= new Set(acc.summaries.map((s) => s.toLowerCase())));
    if (!seen.has(key)) {
      seen.add(key);
      acc.summaries.push(semantic.summary);
    }
  }
}

function selectTopDomainCandidates(sem: SemAcc, maxCount = 12): Array<{ intent: string; topic: string }> {
  const pool = [...sem.candidates];
  const chosen: IntentCandidate[] = [];
  const entityCount = new Map<string, number>();
  const topicCount = new Map<string, number>();
  const words: WordCache = new Map();

  while (chosen.length < maxCount && pool.length > 0) {
    let bestIdx = -1;
    let bestEffective = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (chosen.some((ch) => intentsTooSimilar(ch.intent, c.intent, words))) continue;
      const usedEntity = entityCount.get(c.entity) ?? 0;
      const usedTopic = topicCount.get(c.topic) ?? 0;
      const eff = c.baseScore - usedEntity * 1.5 - usedTopic * 0.8;
      if (eff > bestEffective) {
        bestEffective = eff;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const pick = pool.splice(bestIdx, 1)[0];
    chosen.push(pick);
    if (pick.entity) entityCount.set(pick.entity, (entityCount.get(pick.entity) ?? 0) + 1);
    if (pick.topic) topicCount.set(pick.topic, (topicCount.get(pick.topic) ?? 0) + 1);
  }

  return chosen.map((c) => ({ intent: capWord(c.intent), topic: c.topic }));
}

function selectTopDomainIntents(sem: SemAcc, maxCount = 4): string[] {
  return selectTopDomainCandidates(sem, maxCount).map((c) => c.intent);
}

function truncateLine(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const sliced = t.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const cleanCut = lastSpace >= Math.floor(max * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${cleanCut.replace(/[,:;.\s-]+$/, '')}…`;
}

export function buildDomainCovers(label: string, topics: string[], sem: SemAcc): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const line = scrubStakeholderLine(raw);
    if (!line || !isStakeholderFacingLine(line)) return;
    const key = line.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(truncateLine(capWord(line), 88));
  };

  for (const intent of selectTopDomainIntents(sem, 4)) {
    push(intent);
  }
  for (const [entity] of [...sem.entities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    if (out.length >= 4) break;
    // Skip bare single-word entity tokens ("vessel", "employee") when richer covers exist.
    if (out.length > 0 && !entity.trim().includes(' ')) continue;
    push(entity);
  }
  for (const [intent] of [...sem.intents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    if (out.length >= 4) break;
    if (TECHNICAL_INTENT_NOISE_RE.test(intent) || NON_QUESTION_PREFIX_RE.test(intent)) continue;
    push(intent);
  }
  if (out.length === 0 && sem.summaries[0]) push(sem.summaries[0]);
  if (out.length === 0) {
    for (const t of topics.slice(0, 3)) push(capWord(t));
  }
  if (out.length === 0) push(`Explore metrics and trends in ${label}`);
  return out.slice(0, 4);
}

export function taglineFromCovers(covers: string[], label: string, topics: string[], key?: string): string {
  if (key && DOMAIN_TAGLINES[key]) return DOMAIN_TAGLINES[key];
  if (covers.length >= 2) {
    return `Covers ${covers.slice(0, 3).map((c) => truncateLine(c, 48)).join(' · ')}.`;
  }
  if (covers.length === 1) return truncateLine(covers[0], 140);
  return areaTagline(label, topics, key);
}

const VERB_LEAD_RE =
  /^(check|summari[sz]e|analy[sz]e|list|count|compare|filter|retrieve|get|find|track|aggregate|breakdown|break\s+down|explore|show|rank|identify|monitor|audit)\b/i;

function offerFromIntent(domainLabel: string, rawIntent: string, topic?: string): WelcomeOffer {
  const cleaned = rawIntent
    .trim()
    .replace(/^summarise\b/i, 'Summarize')
    .replace(/^analyse\b/i, 'Analyze')
    .replace(/\.$/, '');
  const label = truncateLine(capWord(cleaned), 76);
  const body = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  const prompt = VERB_LEAD_RE.test(cleaned)
    ? `In ${domainLabel}, ${body}.`
    : `In ${domainLabel}, show ${body}.`;
  return topic ? { label, prompt, topic } : { label, prompt };
}

export function buildDomainOffers(
  area: Pick<WelcomeArea, 'label' | 'topics'> & {
    intents?: string[];
    candidates?: Array<{ intent: string; topic: string }>;
  },
): WelcomeOffer[] {
  const { label, topics, intents = [], candidates } = area;
  const offers: WelcomeOffer[] = [];
  const seenLabels = new Set<string>();

  const sourceItems =
    candidates && candidates.length > 0
      ? candidates.slice(0, 12)
      : intents.slice(0, 12).map((intent) => ({ intent, topic: undefined }));

  for (const item of sourceItems) {
    const offer = offerFromIntent(label, item.intent, item.topic);
    const key = offer.label.toLowerCase();
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    offers.push(offer);
  }

  if (offers.length === 0) {
    const t0 = topics[0];
    const t1 = topics[1];
    if (t0) {
      offers.push({
        label: `Overview of ${capWord(t0)}`,
        prompt: `In ${label}, give me a breakdown of ${t0} and the main patterns to know.`,
      });
    }
    if (t1) {
      offers.push({
        label: `Breakdown by ${capWord(t1)}`,
        prompt: `In ${label}, show how metrics break down by ${t1}.`,
      });
    }
  }

  offers.push({
    label: `Brief me on ${label}`,
    prompt: `Give me a two-minute briefing on what our ${label} data covers — no table names — and the three best questions to ask first.`,
  });

  if (offers.length < 4) {
    offers.push({
      label: `Key metrics in ${label}`,
      prompt: `In ${label}, what are the main metrics and breakdowns I can track right now?`,
    });
  }

  return offers.slice(0, 13);
}

function buildDomainSubtopics(offers: WelcomeOffer[]): WelcomeSubtopic[] {
  const counts = new Map<string, number>();
  for (const o of offers) {
    if (!o.topic) continue;
    counts.set(o.topic, (counts.get(o.topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label,
      count,
    }))
    .slice(0, 6);
}

/** @deprecated Schema grouping only — kept for tests; domains use buildWelcomeCatalog. */
export function humanizeSchema(schema: string): string {
  const LAYER = new Set(['gold', 'silver', 'bronze', 'raw', 'stg', 'staging', 'curated', 'prod', 'dw', 'mart', 'vw', 'v']);
  const words = schema.split(/[_\-\s.]+/).filter(Boolean);
  const meaningful = words.filter((w) => !LAYER.has(w.toLowerCase()));
  const use = meaningful.length > 0 ? meaningful : words;
  const text = use.join(' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : schema;
}

export function buildWelcomeCatalog(
  objects: WelcomeObject[],
  options: BuildWelcomeOptions | number = {},
): WelcomeCatalog {
  const opts: BuildWelcomeOptions = typeof options === 'number' ? { maxAreas: options } : options;
  const maxAreas = opts.maxAreas ?? 12;
  const departments = opts.departments ?? [];
  const deptNameByKey = new Map(departments.map((d) => [d.key, d.name]));

  type Acc = { count: number; kw: Map<string, number>; sem: SemAcc };
  const emptySem = (): SemAcc => ({ entities: new Map(), intents: new Map(), candidates: [], summaries: [] });
  const byDept = new Map<string, Acc>();
  let last: number | null = null;

  for (const o of objects) {
    if (!o.full_path?.trim()) continue;
    const deptKey = resolveObjectDepartmentKey(o.full_path, departments);
    let acc = byDept.get(deptKey);
    if (!acc) {
      acc = { count: 0, kw: new Map(), sem: emptySem() };
      byDept.set(deptKey, acc);
    }
    acc.count += 1;
    ingestSemantic(acc.sem, o, deptKey);
    for (const raw of o.domain_keywords ?? []) {
      const k = raw.trim().toLowerCase();
      if (!stakeholderTopic(k)) continue;
      acc.kw.set(k, (acc.kw.get(k) ?? 0) + 1);
    }
    const t = o.last_t0_at?.getTime();
    if (t != null && (last == null || t > last)) last = t;
  }

  const orderedKeys = sortDepartmentKeys(
    [...byDept.entries()]
      .filter(([, a]) => a.count > 0)
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .map(([k]) => k),
  );

  const areas: WelcomeArea[] = orderedKeys.slice(0, maxAreas).map((deptKey) => {
    const a = byDept.get(deptKey)!;
    const label = displayDepartmentName(deptKey, deptNameByKey.get(deptKey));
    const labelWords = new Set(label.toLowerCase().split(/\s+/));
    const topics = [...a.kw.entries()]
      .filter(([k]) => !labelWords.has(k) && !deptKey.includes(k))
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 4)
      .map(([k]) => k);
    const topCandidates = selectTopDomainCandidates(a.sem, 12);
    const covers = buildDomainCovers(label, topics, a.sem);
    const offers = buildDomainOffers({ label, topics, candidates: topCandidates });
    const subtopics = buildDomainSubtopics(offers);
    return {
      key: deptKey,
      label,
      tableCount: a.count,
      topics,
      tagline: taglineFromCovers(covers, label, topics, deptKey),
      covers,
      offers,
      subtopics,
    };
  });

  return {
    totalTables: objects.length,
    totalAreas: byDept.size,
    lastRefreshedAt: last != null ? new Date(last).toISOString() : null,
    areas,
  };
}
