'use client';

import React, { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import type { OriginClass } from '@/lib/powerbi/source-origin';

export type LaneEdge = { from: string; to: string; kind: 'detected' | 'model_wide' | 'unresolved'; cls: OriginClass | null };

export type LaneItem = { id: string; group?: string; groupTitle?: React.ReactNode; content: React.ReactNode; grow?: boolean };

export type Lane = { key: string; label: string; count?: number; items: LaneItem[]; empty?: React.ReactNode };

export const CLASS_COLOR: Record<OriginClass, string> = {
  warehouse: 'var(--lineage-warehouse)',
  database: 'var(--lineage-database)',
  file: 'var(--lineage-file)',
  model: 'var(--lineage-model)',
  unknown: 'var(--lineage-unknown)',
};

export function edgeColor(edge: Pick<LaneEdge, 'kind' | 'cls'>): string {
  if (edge.kind === 'unresolved') return 'var(--bad)';
  return edge.cls ? CLASS_COLOR[edge.cls] : 'var(--brand-a)';
}

type Geometry = { width: number; height: number; bands: { x: number; y: number; w: number; h: number }[]; paths: (string | null)[] };

const EMPTY: Geometry = { width: 0, height: 0, bands: [], paths: [] };
const MAX_PARTICLES = 48;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const reducedQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCED_MOTION) : null);

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = reducedQuery();
      query?.addEventListener?.('change', onChange);
      return () => query?.removeEventListener?.('change', onChange);
    },
    () => reducedQuery()?.matches ?? false,
    () => false,
  );
}

/**
 * Fixed lanes of nodes joined by curved edges. Edge endpoints are spread down each node and
 * ordered by the other end's height so lines fan in and out instead of meeting at one point.
 * `hotNodes` / `hotEdges` focus a path (everything else fades); `animateEdges` sends dots along
 * those edges in the direction data flows (skipped when the user prefers reduced motion).
 */
export function LaneCanvas({
  lanes,
  edges,
  hotNodes,
  hotEdges,
  selectedId,
  markedIds,
  animateEdges,
  onHover,
  columns = 'minmax(220px,1.15fr) minmax(190px,1fr) minmax(190px,1fr) minmax(170px,0.8fr)',
  ariaLabel,
}: {
  lanes: Lane[];
  edges: LaneEdge[];
  hotNodes: Set<string> | null;
  hotEdges: Set<number> | null;
  selectedId?: string | null;
  markedIds?: string[] | null;
  animateEdges?: number[] | null;
  onHover?: (id: string | null) => void;
  columns?: string;
  ariaLabel: string;
}) {
  const flowRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry>(EMPTY);
  const reducedMotion = usePrefersReducedMotion();

  const measure = useCallback(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const fr = flow.getBoundingClientRect();
    const box = new Map<string, { l: number; r: number; t: number; h: number }>();
    flow.querySelectorAll<HTMLElement>('[data-lane-node]').forEach((el) => {
      const r = el.getBoundingClientRect();
      box.set(el.dataset.laneNode!, { l: r.left - fr.left, r: r.right - fr.left, t: r.top - fr.top, h: r.height });
    });
    const bands = [...flow.querySelectorAll<HTMLElement>('[data-lane]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - fr.left - 9, y: r.top - fr.top - 7, w: r.width + 18, h: r.height + 14 };
    });
    type Live = { i: number; a: { l: number; r: number; t: number; h: number }; b: { l: number; r: number; t: number; h: number }; y1: number; y2: number };
    const live: Live[] = [];
    edges.forEach((edge, i) => {
      const a = box.get(edge.from);
      const b = box.get(edge.to);
      if (a && b) live.push({ i, a, b, y1: 0, y2: 0 });
    });
    const port = (bx: { t: number; h: number }, index: number, count: number) => {
      if (count === 1) return bx.t + bx.h / 2;
      const pad = Math.min(12, bx.h * 0.2);
      return bx.t + pad + ((bx.h - 2 * pad) * (index + 0.5)) / count;
    };
    const mid = (bx: { t: number; h: number }) => bx.t + bx.h / 2;
    const outs = new Map<string, Live[]>();
    const ins = new Map<string, Live[]>();
    for (const item of live) {
      const edge = edges[item.i]!;
      const out = outs.get(edge.from);
      if (out) out.push(item); else outs.set(edge.from, [item]);
      const into = ins.get(edge.to);
      if (into) into.push(item); else ins.set(edge.to, [item]);
    }
    outs.forEach((list) => { list.sort((p, q) => mid(p.b) - mid(q.b)); list.forEach((x, k) => { x.y1 = port(x.a, k, list.length); }); });
    ins.forEach((list) => { list.sort((p, q) => mid(p.a) - mid(q.a)); list.forEach((x, k) => { x.y2 = port(x.b, k, list.length); }); });
    const paths: (string | null)[] = edges.map(() => null);
    for (const x of live) {
      const x1 = x.a.r;
      const x2 = x.b.l;
      const dx = Math.max(24, (x2 - x1) * 0.5);
      const f = (n: number) => n.toFixed(1);
      paths[x.i] = `M${f(x1)},${f(x.y1)} C${f(x1 + dx)},${f(x.y1)} ${f(x2 - dx)},${f(x.y2)} ${f(x2)},${f(x.y2)}`;
    }
    setGeo({ width: fr.width, height: fr.height, bands, paths });
  }, [edges]);

  // Re-measure when the set of nodes changes (not on every parent render) and on resize.
  const layoutKey = lanes.map((lane) => `${lane.key}:${lane.items.map((item) => item.id).join(',')}`).join('|');
  useLayoutEffect(() => {
    measure();
    const flow = flowRef.current;
    if (!flow || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(flow);
    return () => observer.disconnect();
  }, [measure, layoutKey]);

  const focused = Boolean(hotNodes);
  const particles = !reducedMotion && animateEdges?.length && animateEdges.length <= MAX_PARTICLES ? animateEdges : [];

  return (
    <div className="min-w-0 w-full max-w-full overflow-x-auto overscroll-x-contain scrollbar-thin">
      <div
        ref={flowRef}
        role="group"
        aria-label={ariaLabel}
        className="relative grid min-w-[900px] gap-x-16 px-[18px] pb-[18px] pt-[14px]"
        style={{ gridTemplateColumns: columns }}
        onMouseLeave={onHover ? () => onHover(null) : undefined}
        onMouseOver={onHover ? (event) => {
          const node = (event.target as HTMLElement).closest<HTMLElement>('[data-lane-node]');
          onHover(node?.dataset.laneNode ?? null);
        } : undefined}
      >
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-visible"
          width="100%"
          height="100%"
          viewBox={geo.width ? `0 0 ${geo.width} ${geo.height}` : undefined}
        >
          {geo.bands.map((band, i) => (
            <rect key={i} x={band.x} y={band.y} width={band.w} height={band.h} rx={12} fill="var(--lineage-lane)" />
          ))}
          {edges.map((edge, i) => {
            const d = geo.paths[i];
            if (!d) return null;
            const hot = hotEdges?.has(i) ?? false;
            const base = edge.kind === 'unresolved' ? 0.85 : edge.kind === 'model_wide' ? 0.45 : 0.5;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={d}
                fill="none"
                stroke={edgeColor(edge)}
                strokeOpacity={focused ? (hot ? 1 : 0.07) : base}
                strokeWidth={focused && hot ? 2.4 : 1.6}
                strokeDasharray={edge.kind === 'model_wide' ? '4 4' : edge.kind === 'unresolved' ? '2 3' : undefined}
                style={{ transition: 'stroke-opacity .2s, stroke-width .2s' }}
                data-edge={`${edge.from}->${edge.to}`}
                data-hot={hot ? 'true' : undefined}
              />
            );
          })}
          {particles.map((i, n) => {
            const d = geo.paths[i];
            const edge = edges[i];
            if (!d || !edge) return null;
            return (
              <circle key={`p${i}`} r={2.6} fill={edgeColor(edge)}>
                <animateMotion dur="1.8s" repeatCount="indefinite" begin={`${(-(n % 6) * 0.3).toFixed(1)}s`} path={d} />
              </circle>
            );
          })}
        </svg>
        {lanes.map((lane, laneIndex) => (
          <div key={lane.key} data-lane={lane.key} className="relative z-[1] flex min-w-0 flex-col gap-[7px]">
            <div className="relative mb-1 flex items-baseline justify-between gap-1.5 border-b border-dashed border-[var(--estate-border)] px-0.5 pb-1.5">
              <span className="text-eyebrow uppercase text-[var(--estate-text-secondary)]">{lane.label}</span>
              {lane.count != null && <span className="text-size-caption tabular-nums text-[var(--estate-text-dim)]">{lane.count}</span>}
              {laneIndex < lanes.length - 1 && (
                <span aria-hidden className="absolute -right-[41px] -top-[3px] text-size-body text-[var(--estate-text-dim)]">→</span>
              )}
            </div>
            {lane.items.length === 0 && lane.empty}
            {lane.items.map((item, index) => {
              const showGroup = item.group != null && item.group !== lane.items[index - 1]?.group;
              const hot = hotNodes?.has(item.id) ?? false;
              return (
                <React.Fragment key={item.id}>
                  {showGroup && (
                    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 pl-0.5 text-eyebrow text-[var(--estate-text-muted)]" title={item.group}>
                      {item.groupTitle ?? <span className="truncate">{item.group}</span>}
                    </div>
                  )}
                  <div
                    data-lane-node={item.id}
                    data-hot={hot ? 'true' : undefined}
                    className={cn(
                      'min-w-0 rounded-lg transition-[opacity,box-shadow] duration-150',
                      item.grow && 'flex flex-1 flex-col',
                      focused && !hot && 'opacity-[0.28]',
                      selectedId === item.id && 'shadow-[0_0_0_3px_var(--brand-a-soft)]',
                      markedIds?.includes(item.id) && 'shadow-[0_0_0_3px_var(--warn-bg)]',
                    )}
                  >
                    {item.content}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClassSwatch({ cls, round, title }: { cls: OriginClass; round?: boolean; title?: string }) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title}
      className={cn('inline-block size-[9px] shrink-0', round ? 'rounded-full' : 'rounded-[2px]')}
      style={cls === 'unknown'
        ? { background: 'repeating-linear-gradient(45deg,var(--lineage-unknown) 0 2px,transparent 2px 4px)', outline: '1px solid var(--lineage-unknown)', outlineOffset: -1 }
        : { background: CLASS_COLOR[cls] }}
    />
  );
}

export function ClassMixBar({ mix, className }: { mix: { cls: OriginClass; count: number }[]; className?: string }) {
  const total = mix.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <div className={cn('flex h-1 gap-px overflow-hidden rounded-sm bg-[var(--estate-active-bg)]', className)}>
      {total > 0 && mix.map((entry) => (
        <i key={entry.cls} className="block h-full" style={{ width: `${(entry.count / total) * 100}%`, background: CLASS_COLOR[entry.cls] }} />
      ))}
    </div>
  );
}
