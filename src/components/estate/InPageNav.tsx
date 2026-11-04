'use client';

// InPageNav — anchored section navigation for the Estate Object Detail page.
//
// Five sections: #overview · #meaning · #relationships · #operations · #usage
//
// Sits below the page header and sticks to the top of the scroll container.
// Active section is tracked via IntersectionObserver on each section ref.
// `badges` shows a small count / status next to a tab label; `rightSlot`
// hosts the DataReadinessPill so the readiness summary needs no row of its own.

import React, { useEffect, useState } from 'react';

export interface SectionRefs {
  overview:      React.RefObject<HTMLElement | null>;
  meaning:       React.RefObject<HTMLElement | null>;
  relationships: React.RefObject<HTMLElement | null>;
  operations:    React.RefObject<HTMLElement | null>;
  usage:         React.RefObject<HTMLElement | null>;
}

type SectionId = keyof SectionRefs;

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'overview',      label: 'Overview' },
  { id: 'meaning',       label: 'Meaning' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'operations',    label: 'Operations' },
  { id: 'usage',         label: 'Usage' },
];

interface InPageNavProps {
  sectionRefs: SectionRefs;
  /** Small badge after a tab label, e.g. a relationship count. */
  badges?: Partial<Record<SectionId, { text: string; tone?: 'neutral' | 'attention' }>>;
  /** Content pinned to the right end of the bar (readiness pill). */
  rightSlot?: React.ReactNode;
}

export default function InPageNav({ sectionRefs, badges = {}, rightSlot }: InPageNavProps) {
  const [active, setActive] = useState<SectionId>('overview');

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    SECTIONS.forEach(({ id }) => {
      const el = sectionRefs[id].current;
      if (!el) return;

      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActive(id);
        },
        { threshold: 0.2, rootMargin: '-60px 0px -40% 0px' },
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [sectionRefs]);

  const scrollTo = (id: SectionId) => {
    const el = sectionRefs[id].current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <nav
      aria-label="Page sections"
      className="scrollbar-thin"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'color-mix(in srgb, var(--estate-bg) 88%, transparent)',
        backdropFilter: 'saturate(1.4) blur(12px)',
        WebkitBackdropFilter: 'saturate(1.4) blur(12px)',
        borderBottom: '1px solid var(--estate-border)',
        display: 'flex',
        alignItems: 'stretch',
        gap: 4,
        padding: '0 40px',
        height: 48,
        overflowX: 'auto',
      }}
    >
      {SECTIONS.map(({ id, label }) => {
        const isActive = active === id;
        const badge = badges[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => scrollTo(id)}
            aria-current={isActive ? 'location' : undefined}
            className="text-size-ui transition-colors hover:text-[var(--estate-ink)]"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              boxShadow: isActive ? 'inset 0 -2px 0 var(--brand-a)' : 'none',
              color: isActive ? 'var(--estate-ink)' : 'var(--estate-text-muted)',
              fontWeight: isActive ? 600 : 500,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
            {badge && (
              <span
                className="text-size-caption"
                style={{
                  borderRadius: 999,
                  padding: '0 7px',
                  lineHeight: '18px',
                  fontWeight: 600,
                  background: badge.tone === 'attention'
                    ? 'color-mix(in srgb, var(--brand-a) 14%, transparent)'
                    : 'var(--estate-active-bg)',
                  color: badge.tone === 'attention' ? 'var(--brand-a-ink)' : 'var(--estate-text-secondary)',
                }}
              >
                {badge.text}
              </span>
            )}
          </button>
        );
      })}
      {rightSlot}
    </nav>
  );
}
