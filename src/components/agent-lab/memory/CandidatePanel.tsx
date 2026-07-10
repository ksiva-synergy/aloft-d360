'use client';

import React from 'react';
import { HelpCircle, ShieldAlert, Trash2 } from 'lucide-react';
import { GOLD, RULE_TYPE_COLORS, ruleTypeColor } from '@/lib/foer/foer-tokens';

// Define the shape of active bullets returned from the trace route
export interface BulletItem {
  id: string;
  ruleText: string;
  ruleType: string;
  confidence: number;
  rationale: string | null;
  createdAt: string | Date;
}

interface CandidatePanelProps {
  bullets: BulletItem[];
  candidatesProduced: number;
  phantomsBlocked: number;
  bulletsInserted: number;
  bulletsDeduped: number;
  bulletsSuperseded: number;
}

export function CandidatePanel({
  bullets,
  candidatesProduced,
  phantomsBlocked,
  bulletsInserted,
  bulletsDeduped,
  bulletsSuperseded,
}: CandidatePanelProps) {
  // Kept count
  const keptCount = bulletsInserted + bulletsDeduped + bulletsSuperseded;
  
  // Marcus Sieved count = candidatesProduced - (kept + phantomsBlocked)
  // Ensure it's non-negative
  const marcusSieved = Math.max(0, candidatesProduced - (keptCount + phantomsBlocked));

  // State for hover styles
  const [marcusHovered, setMarcusHovered] = React.useState(false);
  const [ramaHovered, setRamaHovered] = React.useState(false);

  return (
    <div className="flex flex-col gap-6 rounded border border-[var(--foer-border-dim)] bg-[var(--foer-surface)] p-5">
      {/* Header and Discard Summaries */}
      <div className="flex flex-col gap-4 border-b border-[var(--foer-border-dim)] pb-4">
        <h3 className="font-mono text-xs font-semibold tracking-wider text-[var(--foer-text-sec)]">
          KEEPER'S VERDICT METRICS
        </h3>
        
        {/* Aggregated Discard Badges */}
        <div className="grid grid-cols-2 gap-3">
          {/* Marcus Sieved Badge */}
          <div
            className="group relative flex flex-col justify-between rounded bg-[var(--foer-surface2)] p-3 border transition-colors"
            onMouseEnter={() => setMarcusHovered(true)}
            onMouseLeave={() => setMarcusHovered(false)}
            style={{
              borderColor: marcusHovered ? RULE_TYPE_COLORS.FAILURE_MODE : 'var(--foer-border-dim)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--foer-text-mut)]">
                Marcus Sieved
              </span>
              <HelpCircle size={10} className="text-[var(--foer-text-mut)] cursor-help" />
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span
                className="font-mono text-2xl font-semibold"
                style={{ color: RULE_TYPE_COLORS.FAILURE_MODE }}
              >
                {marcusSieved}
              </span>
              <span className="text-[9px] text-[var(--foer-text-mut)] font-mono">candidates</span>
            </div>
            {/* Tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-52 -translate-x-1/2 rounded border border-[var(--foer-border)] bg-[var(--foer-card-bg)] p-2 text-center font-mono text-[9px] text-[var(--foer-text-pri)] shadow-lg opacity-0 transition-opacity group-hover:opacity-100">
              Transient noise (typos, retry loops, timeouts) discarded by the filter sieve.
            </div>
          </div>

          {/* Rama Blocked Badge */}
          <div
            className="group relative flex flex-col justify-between rounded bg-[var(--foer-surface2)] p-3 border transition-colors"
            onMouseEnter={() => setRamaHovered(true)}
            onMouseLeave={() => setRamaHovered(false)}
            style={{
              borderColor: ramaHovered ? GOLD : 'var(--foer-border-dim)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--foer-text-mut)]">
                Rama Blocked
              </span>
              <ShieldAlert size={10} className="text-[var(--foer-text-mut)] cursor-help" />
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span
                className="font-mono text-2xl font-semibold"
                style={{ color: GOLD }}
              >
                {phantomsBlocked}
              </span>
              <span className="text-[9px] text-[var(--foer-text-mut)] font-mono">phantoms</span>
            </div>
            {/* Tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-52 -translate-x-1/2 rounded border border-[var(--foer-border)] bg-[var(--foer-card-bg)] p-2 text-center font-mono text-[9px] text-[var(--foer-text-pri)] shadow-lg opacity-0 transition-opacity group-hover:opacity-100">
              Phantom references blocked (referenced entities not found in the trace outcome).
            </div>
          </div>
        </div>
      </div>

      {/* Kept Playbook Rules */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h4 className="font-mono text-[10px] font-semibold text-[var(--foer-text-sec)]">
            KEPT MEMORIES ({bullets.length})
          </h4>
          <span className="font-mono text-[9px] text-[var(--foer-text-mut)]">
            Total Produced: {candidatesProduced}
          </span>
        </div>

        {bullets.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded bg-[var(--foer-surface2)] border border-dashed border-[var(--foer-border-dim)] p-4 text-center">
            <span className="font-mono text-[10px] text-[var(--foer-text-mut)]">
              No memory bullets retained from this session.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-h-[380px] overflow-y-auto pr-1">
            {bullets.map((bullet) => {
              const accentColor = ruleTypeColor(bullet.ruleType);
              return (
                <div
                  key={bullet.id}
                  className="relative flex flex-col gap-2 rounded bg-[var(--foer-card-bg)] p-3 shadow-sm border border-[var(--foer-border-dim)]"
                  style={{ borderLeftWidth: '3px', borderLeftColor: accentColor }}
                >
                  {/* Type and Confidence row */}
                  <div className="flex items-center justify-between">
                    <span
                      className="font-mono text-[8px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${accentColor}15`,
                        color: accentColor,
                      }}
                    >
                      {bullet.ruleType.replace('_', ' ')}
                    </span>
                    <span className="font-mono text-[8px] text-[var(--foer-text-mut)]">
                      Confidence: {(bullet.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  {/* Rule Text */}
                  <p className="text-xs text-[var(--foer-text-pri)] leading-relaxed font-medium">
                    {bullet.ruleText}
                  </p>

                  {/* Rationale */}
                  {bullet.rationale && (
                    <div className="border-t border-[var(--foer-border-dim)] pt-1.5 mt-0.5">
                      <span className="font-mono text-[8px] text-[var(--foer-text-mut)] block mb-0.5">
                        RATIONALE:
                      </span>
                      <p className="text-[10px] text-[var(--foer-text-sec)] italic">
                        {bullet.rationale}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Decorative Caption */}
      <div className="border-t border-[var(--foer-border-dim)] pt-4 text-center">
        <p className="font-serif text-[11px] italic text-[var(--foer-text-mut)] leading-relaxed px-4">
          "Failures become rules in the imperative. A retry loop becomes nothing."
        </p>
      </div>
    </div>
  );
}
