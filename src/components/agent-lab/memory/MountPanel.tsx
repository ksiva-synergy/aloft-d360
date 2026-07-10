'use client';

/**
 * MountPanel.tsx -- FOER-6: Three-phase injection preview for Operating Memory.
 *
 * CLIENT-SIDE PREVIEW ONLY -- never calls selectMemory (no lastUsedAt side effects).
 * All ranking is computed locally from /browse + /signatures responses.
 *
 * Phase 0  (INIT):          Fatal HARD_RULEs (confidence >= 0.9, harmfulCount >= 1).
 *                           Budget: 200t. -> System prompt.
 * Phase 1a (SCHEMA_GLOBAL): SCHEMA_MAPs grouped by topicName (shelf) then
 *                           taskSignature (sub-shelf). Budget: 800t. -> System prompt.
 * Phase 1b (TASK_SCOPED):   HEURISTIC / SOURCE_PREF / FAILURE_MODE scoped to the
 *                           selected taskSignature. Budget: 800t. -> Recall turn.
 *
 * Total preview budget: 1800 tokens.
 */

import { useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import type { SignatureEntry } from '@/app/api/agent-lab/memory/signatures/route';
import { MONO, SERIF, GOLD, RULE_TYPE_COLORS } from '@/lib/foer/foer-tokens';

// -- Types ---------------------------------------------------------------------

interface BrowseBullet {
  id:            string;
  agentClass:    string;
  taskSignature: string | null;
  ruleText:      string;
  ruleType:      string;
  confidence:    number;
  helpfulCount:  number;
  harmfulCount:  number;
  status:        string;
  lastUsedAt:    string | null;
}

interface PhaseSlot {
  bullet:     BrowseBullet;
  tokens:     number;
  score:      number;
  overBudget: boolean;
}

interface PhaseSplit {
  p0:  PhaseSlot[];
  p1a: PhaseSlot[];
  p1b: PhaseSlot[];
}

// -- Constants -----------------------------------------------------------------

const P0_BUDGET      = 200;
const P1A_BUDGET     = 600;
const P1B_BUDGET     = 1200;
const TOTAL_BUDGET   = P0_BUDGET + P1A_BUDGET + P1B_BUDGET;

const P0_CONF_FLOOR  = 0.9;
const P0_MIN_HARMFUL = 1;

const P1A_TYPES = new Set(['SCHEMA_MAP']);
const P1B_TYPES = new Set(['HEURISTIC', 'SOURCE_PREF', 'FAILURE_MODE']);

const DEFAULT_GUARDRAIL: BrowseBullet = {
  id:            '__default_guardrail__',
  agentClass:    '*',
  taskSignature: null,
  ruleText:      'Before acting, verify that requested tables/columns exist in the schema context provided. Never fabricate column names, never assume a JOIN path without confirming foreign-key relationships, and always prefer explicit casting over implicit type coercion.',
  ruleType:      'HARD_RULE',
  confidence:    1.0,
  helpfulCount:  100,
  harmfulCount:  0,
  status:        'ACTIVE',
  lastUsedAt:    null,
};

// -- Helpers -------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function recency(lastUsedAt: string | null): number {
  if (!lastUsedAt) return 0.4;
  const ageDays = (Date.now() - new Date(lastUsedAt).getTime()) / 86_400_000;
  if (ageDays <= 7)  return 1.0;
  if (ageDays <= 30) return 0.7;
  return 0.4;
}

function bulletScore(b: BrowseBullet): number {
  return b.confidence * Math.max(0, b.helpfulCount - b.harmfulCount) * recency(b.lastUsedAt);
}

function fillPhase(candidates: BrowseBullet[], budget: number, excludeIds: Set<string>): PhaseSlot[] {
  const slots: PhaseSlot[] = [];
  let used = 0;
  for (const b of candidates) {
    if (excludeIds.has(b.id)) continue;
    const tokens     = estimateTokens(b.ruleText);
    const overBudget = used + tokens > budget;
    slots.push({ bullet: b, tokens, score: bulletScore(b), overBudget });
    if (!overBudget) used += tokens;
  }
  return slots;
}

// -- Fetchers ------------------------------------------------------------------

async function fetchSignatures(): Promise<{ signatures: SignatureEntry[] }> {
  const res = await fetch('/api/agent-lab/memory/signatures');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAllActiveBullets(): Promise<BrowseBullet[]> {
  const res = await fetch('/api/agent-lab/memory/browse?status=ACTIVE&pageSize=200');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { bullets: BrowseBullet[] };
  return data.bullets ?? [];
}

// -- Phase computation ---------------------------------------------------------

function computePhases(bullets: BrowseBullet[], taskSignature: string, signatures: SignatureEntry[]): PhaseSplit {
  const selectedEntry = signatures.find((s) => s.taskSignature === taskSignature);
  const topicKey      = selectedEntry?.topicKey ?? null;
  const topicSigs     = new Set(
    topicKey
      ? signatures.filter((s) => s.topicKey === topicKey).map((s) => s.taskSignature)
      : [taskSignature],
  );

  // Phase 0: always starts with the default guardrail, then adds DB HARD_RULEs
  const defaultSlot: PhaseSlot = { bullet: DEFAULT_GUARDRAIL, tokens: estimateTokens(DEFAULT_GUARDRAIL.ruleText), score: 100, overBudget: false };
  const p0Cands = bullets
    .filter((b) => b.ruleType === 'HARD_RULE' && b.confidence >= P0_CONF_FLOOR && b.harmfulCount >= P0_MIN_HARMFUL)
    .sort((a, b) => bulletScore(b) - bulletScore(a));
  const p0Extra = fillPhase(p0Cands, P0_BUDGET - defaultSlot.tokens, new Set([DEFAULT_GUARDRAIL.id]));
  const p0     = [defaultSlot, ...p0Extra];
  const p0Ids  = new Set(p0.map((s) => s.bullet.id));

  const p1aCands = bullets
    .filter((b) => P1A_TYPES.has(b.ruleType) && (b.taskSignature === null || topicSigs.has(b.taskSignature)))
    .sort((a, b) => bulletScore(b) - bulletScore(a));
  const p1a    = fillPhase(p1aCands, P1A_BUDGET, p0Ids);
  const p1aIds = new Set([...p0Ids, ...p1a.map((s) => s.bullet.id)]);

  // Phase 1b: task-scoped rules -- include rules matching the selected signature,
  // global rules (null taskSignature), and rules from sibling sigs in the same topic group
  const p1bCands = bullets
    .filter((b) => P1B_TYPES.has(b.ruleType) && (b.taskSignature === taskSignature || b.taskSignature === null || topicSigs.has(b.taskSignature!)))
    .sort((a, b) => bulletScore(b) - bulletScore(a));
  const p1b = fillPhase(p1bCands, P1B_BUDGET, p1aIds);

  return { p0, p1a, p1b };
}

// -- Sub-components ------------------------------------------------------------

const orbStyle = (ruleType: string, overBudget: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  fontFamily: MONO, fontSize: '0.60rem',
  color: 'var(--foer-text-sec)', background: 'var(--foer-surface2)',
  border: `1px solid ${RULE_TYPE_COLORS[ruleType] ?? GOLD}40`,
  borderRadius: '3px', padding: '2px 6px', cursor: 'default',
  maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  opacity: overBudget ? 0.35 : 1,
});

function BulletOrb({ slot }: { slot: PhaseSlot }) {
  return (
    <span title={slot.bullet.ruleText} style={orbStyle(slot.bullet.ruleType, slot.overBudget)}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: RULE_TYPE_COLORS[slot.bullet.ruleType] ?? GOLD, flexShrink: 0, display: 'inline-block' }} />
      {slot.bullet.ruleType.replace(/_/g, ' ')}  -  {slot.tokens}t
    </span>
  );
}

interface ShelfGroup { label: string; subLabel?: string; slots: PhaseSlot[] }

function ShelfGroupView({ groups, accentColor }: { groups: ShelfGroup[]; accentColor: string }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.map((g) => g.label + (g.subLabel ?? ''))));
  function toggle(key: string) { setOpen((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; }); }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {groups.map((g) => {
        const key    = g.label + (g.subLabel ?? '');
        const isOpen = open.has(key);
        const active = g.slots.filter((s) => !s.overBudget);
        const over   = g.slots.filter((s) => s.overBudget);
        const used   = active.reduce((sum, s) => sum + s.tokens, 0);
        return (
          <div key={key} style={{ border: `1px solid ${accentColor}20`, borderRadius: '4px', overflow: 'hidden' }}>
            <div onClick={() => toggle(key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.6rem', cursor: 'pointer', background: 'var(--foer-surface2)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.60rem', color: accentColor, letterSpacing: '0.06em' }}>{g.label}</span>
                {g.subLabel && <span style={{ fontFamily: MONO, fontSize: '0.56rem', color: 'var(--foer-text-mut)' }}>{g.subLabel}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.57rem', color: 'var(--foer-text-mut)' }}>{active.length}  -  {used}t{over.length > 0 ? ` +${over.length}` : ''}</span>
                {isOpen ? <ChevronDown size={10} style={{ color: 'var(--foer-text-mut)' }} /> : <ChevronRight size={10} style={{ color: 'var(--foer-text-mut)' }} />}
              </div>
            </div>
            {isOpen && (
              <div style={{ padding: '0.45rem 0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {g.slots.map((s) => <BulletOrb key={s.bullet.id} slot={s} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface PhaseBlurbProps {
  phaseLabel:    string;
  phaseTag:      string;
  accentColor:   string;
  budget:        number;
  slots:         PhaseSlot[];
  groups?:       ShelfGroup[];
  previewText:   string;
  injectionPoint: string;
}

function PhaseBlurb({ phaseLabel, phaseTag, accentColor, budget, slots, groups, previewText, injectionPoint }: PhaseBlurbProps) {
  const [expanded,     setExpanded]     = useState(true);
  const [previewOpen,  setPreviewOpen]  = useState(false);
  const active  = slots.filter((s) => !s.overBudget);
  const over    = slots.filter((s) => s.overBudget);
  const used    = active.reduce((sum, s) => sum + s.tokens, 0);
  const pct     = Math.min(100, Math.round((used / budget) * 100));
  const isEmpty = slots.length === 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0,
      border: '1px solid ' + accentColor + '30',
      borderRadius: '6px',
      background: 'var(--foer-surface)',
      overflow: 'hidden',
      height: '100%',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          padding: '0.75rem 1rem',
          cursor: 'pointer',
          borderBottom: '1px solid ' + accentColor + '20',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
          background: accentColor + '08',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: '0.68rem', letterSpacing: '0.10em', color: accentColor, textTransform: 'uppercase', fontWeight: 700 }}>{phaseLabel}</span>
          <span style={{ fontFamily: MONO, fontSize: '0.57rem', color: 'var(--foer-text-mut)', letterSpacing: '0.04em' }}>{injectionPoint}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{
              fontFamily: MONO, fontSize: '0.62rem',
              color: pct >= 90 ? '#D9774B' : isEmpty ? 'var(--foer-text-mut)' : 'var(--foer-text-sec)',
              fontWeight: 600,
            }}>
              {used}/{budget}t
            </span>
            {expanded
              ? <ChevronDown size={11} style={{ color: 'var(--foer-text-mut)' }} />
              : <ChevronRight size={11} style={{ color: 'var(--foer-text-mut)' }} />}
          </div>
          {!isEmpty && (
            <span style={{ fontFamily: MONO, fontSize: '0.55rem', color: 'var(--foer-text-mut)' }}>
              {active.length} rule{active.length !== 1 ? 's' : ''}{over.length > 0 ? ' · +' + over.length + ' cut' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Token fill bar */}
      <div style={{ height: '4px', background: 'var(--foer-border-dim)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: pct + '%',
          background: pct >= 90 ? '#D9774B' : accentColor,
          transition: 'width 0.4s ease',
          opacity: isEmpty ? 0.3 : 1,
        }} />
      </div>

      {expanded && (
        <div style={{ padding: '0.75rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.65rem', minWidth: 0, flex: 1 }}>
          {isEmpty ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem 0', gap: '6px', opacity: 0.5 }}>
              <span style={{ fontFamily: MONO, fontSize: '0.65rem', color: 'var(--foer-text-mut)' }}>No bullets</span>
              <span style={{ fontFamily: MONO, fontSize: '0.58rem', color: 'var(--foer-text-mut)', fontStyle: 'italic' }}>{phaseTag}</span>
            </div>
          ) : groups && groups.length > 0 ? (
            <ShelfGroupView groups={groups} accentColor={accentColor} />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {slots.map((s) => <BulletOrb key={s.bullet.id} slot={s} />)}
            </div>
          )}

          {/* What the agent sees -- expandable drawer */}
          {!isEmpty && previewText && (
            <div style={{ borderTop: '1px solid ' + accentColor + '18', paddingTop: '0.5rem' }}>
              <button
                onClick={() => setPreviewOpen((p) => !p)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '0',
                  display: 'flex', alignItems: 'center', gap: '5px',
                  fontFamily: MONO, fontSize: '0.58rem', color: accentColor, letterSpacing: '0.06em',
                }}
              >
                {previewOpen
                  ? <ChevronDown size={9} />
                  : <ChevronRight size={9} />}
                What the agent sees
              </button>
              {previewOpen && (
                <pre style={{
                  fontFamily: MONO, fontSize: '0.63rem', lineHeight: 1.6,
                  color: 'var(--foer-text-sec)',
                  background: 'var(--foer-surface2)',
                  border: '1px solid ' + accentColor + '22',
                  borderRadius: '4px',
                  padding: '0.75rem 0.9rem',
                  margin: '0.4rem 0 0',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  overflowX: 'auto', maxHeight: '240px', overflowY: 'auto',
                  scrollbarWidth: 'thin',
                }}>
                  {previewText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MountPanel() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const selectedSig  = searchParams.get('taskSignature') ?? '';

  const { data: sigData,    isLoading: sigsLoading    } = useQuery({ queryKey: ['foer-signatures'],          queryFn: fetchSignatures,       staleTime: 60_000 });
  const { data: bulletsRaw, isLoading: bulletsLoading } = useQuery({ queryKey: ['foer-all-active-bullets'], queryFn: fetchAllActiveBullets, staleTime: 60_000 });

  const signatures = sigData?.signatures ?? [];
  const bullets    = bulletsRaw ?? [];

  const activeSig = useMemo(() => {
    if (selectedSig) return selectedSig;
    if (signatures.length === 0) return '';
    return [...signatures].sort((a, b) => b.memberCount - a.memberCount)[0]?.taskSignature ?? '';
  }, [selectedSig, signatures]);

  const phases = useMemo<PhaseSplit>(() => {
    if (!activeSig || bullets.length === 0) return { p0: [], p1a: [], p1b: [] };
    return computePhases(bullets, activeSig, signatures);
  }, [bullets, activeSig, signatures]);

  // Phase 1a shelf groups: topicName -> subLabel (shortLabel/sig)
  const p1aGroups = useMemo<ShelfGroup[]>(() => {
    const groupMap = new Map<string, Map<string, PhaseSlot[]>>();
    for (const slot of phases.p1a) {
      const sig      = slot.bullet.taskSignature ?? '__global__';
      const sigEntry = signatures.find((s) => s.taskSignature === sig);
      const topic    = sigEntry?.topicName ?? 'Global';
      const subLabel = sigEntry?.shortLabel ?? sig.slice(0, 8);
      if (!groupMap.has(topic)) groupMap.set(topic, new Map());
      const topicMap = groupMap.get(topic)!;
      if (!topicMap.has(subLabel)) topicMap.set(subLabel, []);
      topicMap.get(subLabel)!.push(slot);
    }
    const result: ShelfGroup[] = [];
    for (const [topic, subMap] of groupMap.entries()) {
      for (const [subLabel, slots] of subMap.entries()) {
        result.push({ label: topic, subLabel, slots });
      }
    }
    return result;
  }, [phases.p1a, signatures]);

  // Phase 1b groups: one per shortLabel
  const p1bGroups = useMemo<ShelfGroup[]>(() => {
    const groupMap = new Map<string, PhaseSlot[]>();
    for (const slot of phases.p1b) {
      const sig      = slot.bullet.taskSignature ?? '__unknown__';
      const sigEntry = signatures.find((s) => s.taskSignature === sig);
      const label    = sigEntry?.shortLabel ?? sig.slice(0, 8);
      if (!groupMap.has(label)) groupMap.set(label, []);
      groupMap.get(label)!.push(slot);
    }
    return [...groupMap.entries()].map(([label, slots]) => ({ label, slots }));
  }, [phases.p1b, signatures]);

  const p0Text = phases.p0.filter((s) => !s.overBudget).length > 0
    ? ['=== OPERATING MEMORY | phase:init ===', ...phases.p0.filter((s) => !s.overBudget).map((s) => `- [${s.bullet.ruleType}] ${s.bullet.ruleText}`), '=== END OPERATING MEMORY ==='].join('\n')
    : '';
  const p1aText = phases.p1a.filter((s) => !s.overBudget).length > 0
    ? ['=== OPERATING MEMORY | phase:schema-global ===', ...phases.p1a.filter((s) => !s.overBudget).map((s) => `- [${s.bullet.ruleType}] ${s.bullet.ruleText}`), '=== END OPERATING MEMORY ==='].join('\n')
    : '';
  const p1bText = phases.p1b.filter((s) => !s.overBudget).length > 0
    ? ['=== OPERATING MEMORY | phase:task-scoped ===', ...phases.p1b.filter((s) => !s.overBudget).map((s) => `- [${s.bullet.ruleType}] ${s.bullet.ruleText}`), '=== END OPERATING MEMORY ==='].join('\n')
    : '';

  const totalUsed = [...phases.p0, ...phases.p1a, ...phases.p1b].filter((s) => !s.overBudget).reduce((sum, s) => sum + s.tokens, 0);
  const totalPct  = Math.min(100, Math.round((totalUsed / TOTAL_BUDGET) * 100));

  function setSignature(sig: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (sig) p.set('taskSignature', sig); else p.delete('taskSignature');
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  const selectedEntry = signatures.find((s) => s.taskSignature === activeSig);
  const isLoading     = sigsLoading || bulletsLoading;

  const p0Active  = phases.p0.filter((s)  => !s.overBudget);
  const p1aActive = phases.p1a.filter((s) => !s.overBudget);
  const p1bActive = phases.p1b.filter((s) => !s.overBudget);
  const p0Over    = phases.p0.filter((s)  => s.overBudget).length;
  const p1aOver   = phases.p1a.filter((s) => s.overBudget).length;
  const p1bOver   = phases.p1b.filter((s) => s.overBudget).length;

  const p0Used  = p0Active.reduce((s, x)  => s + x.tokens, 0);
  const p1aUsed = p1aActive.reduce((s, x) => s + x.tokens, 0);
  const p1bUsed = p1bActive.reduce((s, x) => s + x.tokens, 0);
  const p0W     = Math.round((p0Used  / TOTAL_BUDGET) * 100);
  const p1aW    = Math.round((p1aUsed / TOTAL_BUDGET) * 100);
  const p1bW    = Math.round((p1bUsed / TOTAL_BUDGET) * 100);

  return (
    <section id="foer-section-mounted" style={{ padding: '56px 0', borderTop: '1px solid var(--foer-border)', display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {/* Section kicker */}
      <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.22em', color: 'var(--foer-text-mut)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ color: GOLD }}>06</span> · MOUNT · INJECTION
      </div>

      {/* Hero */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ fontFamily: SERIF, fontSize: '32px', fontWeight: 600, color: 'var(--foer-text-pri)', margin: '0 0 10px', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Mounted at Task Start
          </h2>
          <p style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--foer-text-mut)', margin: '0 0 18px', lineHeight: 1.7 }}>
            Before the agent speaks its first word, three layers of memory are already loaded--in sequence, at the right moment.
          </p>
          {/* Story pipeline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0', flexWrap: 'nowrap' }}>
            {([
              { step: '0',  label: 'Guardrails', desc: 'Fatal rules first',   color: '#FDB515' },
              { step: '1a', label: 'Schema map', desc: 'Domain knowledge',    color: '#5E7E96' },
              { step: '1b', label: 'Task recall', desc: 'Pattern memory',     color: '#5FA9AE' },
            ] as const).map((item, i) => (
              <div key={item.step} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '6px 12px' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: item.color + '1a', border: '1.5px solid ' + item.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: MONO, fontSize: '0.58rem', color: item.color, fontWeight: 700 }}>{item.step}</span>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: item.color, letterSpacing: '0.04em', fontWeight: 600 }}>{item.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: '0.55rem', color: 'var(--foer-text-mut)' }}>{item.desc}</span>
                </div>
                {i < 2 && (
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '22px' }}>
                    <div style={{ width: 20, height: 1, background: 'var(--foer-border)' }} />
                    <div style={{ width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: '5px solid var(--foer-border)' }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Stats summary card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0', border: '1px solid var(--foer-border)', borderRadius: '6px', overflow: 'hidden', minWidth: 210, flexShrink: 0 }}>
          <div style={{ padding: '8px 14px', background: 'var(--foer-surface2)', borderBottom: '1px solid var(--foer-border)', fontFamily: MONO, fontSize: '0.60rem', letterSpacing: '0.08em', color: 'var(--foer-text-mut)', textTransform: 'uppercase' }}>
            This signature
          </div>
          {([
            { label: 'P0 · guardrails', count: p0Active.length,  over: p0Over,  color: '#FDB515' },
            { label: 'P1a · schema',    count: p1aActive.length, over: p1aOver, color: '#5E7E96' },
            { label: 'P1b · recall',    count: p1bActive.length, over: p1bOver, color: '#5FA9AE' },
          ] as const).map((row, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: i < 2 ? '1px solid var(--foer-border)' : 'none' }}>
              <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: row.color }}>{row.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: 'var(--foer-text-pri)', fontWeight: 600 }}>{row.count}</span>
                {row.over > 0 && <span style={{ fontFamily: MONO, fontSize: '0.56rem', color: '#D9774B' }}>+{row.over} cut</span>}
              </div>
            </div>
          ))}
          <div style={{ padding: '8px 14px', background: 'var(--foer-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--foer-border)' }}>
            <span style={{ fontFamily: MONO, fontSize: '0.60rem', color: 'var(--foer-text-mut)' }}>total tokens</span>
            <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: totalPct >= 90 ? '#D9774B' : 'var(--foer-text-sec)' }}>
              {totalUsed}<span style={{ color: 'var(--foer-text-mut)', fontSize: '0.60rem' }}>/{TOTAL_BUDGET}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Signature selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <label htmlFor="mount-sig-select" style={{ fontFamily: MONO, fontSize: '0.60rem', letterSpacing: '0.1em', color: 'var(--foer-text-mut)', textTransform: 'uppercase' }}>Previewing task signature</label>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--foer-text-mut)', fontFamily: MONO, fontSize: '0.75rem' }}>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading...
            </div>
          ) : (
            <select id="mount-sig-select" className="foer-select" value={activeSig} onChange={(e) => setSignature(e.target.value)} style={{ maxWidth: '420px', fontFamily: MONO, fontSize: '0.72rem', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--foer-border)', background: 'var(--foer-surface)', color: 'var(--foer-text-pri)', appearance: 'none', WebkitAppearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27%238a9bb5%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M8 11L3 6h10l-5 5z%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '28px' }}>
              {signatures.map((s) => (
                <option key={s.taskSignature} value={s.taskSignature} style={{ background: 'var(--foer-surface)', color: 'var(--foer-text-pri)' }}>{s.topicName} · {s.taskSignature.slice(0, 8)}</option>
              ))}
            </select>
          )}
        </div>
        {selectedEntry && (
          <div style={{ fontFamily: MONO, fontSize: '0.62rem', color: 'var(--foer-text-mut)', marginTop: '18px' }}>
            <span style={{ color: 'var(--foer-text-sec)' }}>{selectedEntry.topicName}</span>
            {' · '}{selectedEntry.memberCount} member{selectedEntry.memberCount !== 1 ? 's' : ''}
            {' · '}<span data-testid="honesty-chip" style={{ color: '#C9A04E' }}>AM2.1 preview</span>
          </div>
        )}
      </div>

      {/* Segmented budget bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: '0.60rem', color: 'var(--foer-text-mut)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Token Budget · 1800t total</span>
          <span style={{ fontFamily: MONO, fontSize: '0.65rem', color: totalPct >= 90 ? '#D9774B' : 'var(--foer-text-sec)' }}>{totalUsed}t used</span>
        </div>
        <div style={{ height: '6px', borderRadius: '3px', background: 'var(--foer-border-dim)', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: p0W + '%',  background: '#FDB515', transition: 'width 0.4s ease' }} title={'Phase 0: ' + p0Used + 't'} />
          <div style={{ width: p1aW + '%', background: '#5E7E96', transition: 'width 0.4s ease' }} title={'Phase 1a: ' + p1aUsed + 't'} />
          <div style={{ width: p1bW + '%', background: '#5FA9AE', transition: 'width 0.4s ease' }} title={'Phase 1b: ' + p1bUsed + 't'} />
        </div>
        <div style={{ display: 'flex', gap: '1.25rem' }}>
          {([
            { label: 'P0',  used: p0Used,  budget: P0_BUDGET,  color: '#FDB515' },
            { label: 'P1a', used: p1aUsed, budget: P1A_BUDGET, color: '#5E7E96' },
            { label: 'P1b', used: p1bUsed, budget: P1B_BUDGET, color: '#5FA9AE' },
          ] as const).map((seg) => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '2px', background: seg.color, flexShrink: 0 }} />
              <span style={{ fontFamily: MONO, fontSize: '0.58rem', color: 'var(--foer-text-mut)' }}>{seg.label} {seg.used}/{seg.budget}t</span>
            </div>
          ))}
        </div>
      </div>

      {/* Three-column phase blurbs */}
      {isLoading ? (
        <div style={{ display: 'flex', gap: '1rem' }}>
          {[1, 2, 3].map((i) => <div key={i} className="foer-skeleton" style={{ flex: 1, height: '260px', borderRadius: '6px' }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '0', alignItems: 'stretch' }}>
          {/* Phase 0 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <PhaseBlurb
              phaseLabel="0 · Guardrails"
              phaseTag="phase:init"
              accentColor="#FDB515"
              budget={P0_BUDGET}
              slots={phases.p0}
              previewText={p0Text}
              injectionPoint="System prompt · always first"
            />
          </div>
          {/* Arrow connector */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '28px', flexShrink: 0 }}>
            <div style={{ flex: 1, width: 1, background: 'var(--foer-border-dim)' }} />
            <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <div style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '5px solid var(--foer-border)' }} />
              <span style={{ fontFamily: MONO, fontSize: '8px', color: 'var(--foer-text-mut)', letterSpacing: '0.06em', writingMode: 'vertical-rl' }}>then</span>
            </div>
            <div style={{ flex: 1, width: 1, background: 'var(--foer-border-dim)' }} />
          </div>
          {/* Phase 1a */}
          <div style={{ flex: 2, minWidth: 0 }}>
            <PhaseBlurb
              phaseLabel="1a · Schema Map"
              phaseTag="phase:schema-global"
              accentColor="#5E7E96"
              budget={P1A_BUDGET}
              slots={phases.p1a}
              groups={p1aGroups}
              previewText={p1aText}
              injectionPoint="System prompt · domain knowledge"
            />
          </div>
          {/* Arrow connector */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '28px', flexShrink: 0 }}>
            <div style={{ flex: 1, width: 1, background: 'var(--foer-border-dim)' }} />
            <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <div style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '5px solid var(--foer-border)' }} />
              <span style={{ fontFamily: MONO, fontSize: '8px', color: 'var(--foer-text-mut)', letterSpacing: '0.06em', writingMode: 'vertical-rl' }}>then</span>
            </div>
            <div style={{ flex: 1, width: 1, background: 'var(--foer-border-dim)' }} />
          </div>
          {/* Phase 1b */}
          <div style={{ flex: 1.5, minWidth: 0 }}>
            <PhaseBlurb
              phaseLabel="1b · Task Recall"
              phaseTag="phase:task-scoped"
              accentColor="#5FA9AE"
              budget={P1B_BUDGET}
              slots={phases.p1b}
              groups={p1bGroups.length > 1 ? p1bGroups : undefined}
              previewText={p1bText}
              injectionPoint="Recall turn · task-specific"
            />
          </div>
        </div>
      )}
    </section>
  );
}


