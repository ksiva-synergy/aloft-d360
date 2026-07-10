'use client';

// InPageNav — anchored section navigation for the Estate Object Detail page.
//
// Five sections per the approved design:
//   #overview · #meaning · #relationships · #operations · #usage
//
// Active section is tracked via IntersectionObserver on each section ref.
// Renders as a sticky top-bar nav with gold underline on the active item.
// The DataReadinessPill sits ABOVE this in the DOM (sticky top-0); this nav
// is sticky top-[40px] (below the pill's 40px height).

import React, { useEffect, useRef, useState } from 'react';

export interface SectionRefs {
  overview:      React.RefObject<HTMLElement | null>;
  meaning:       React.RefObject<HTMLElement | null>;
  relationships: React.RefObject<HTMLElement | null>;
  operations:    React.RefObject<HTMLElement | null>;
  usage:         React.RefObject<HTMLElement | null>;
}

type SectionId = keyof SectionRefs;

const SECTIONS: { id: SectionId; label: string; subtitle?: string }[] = [
  { id: 'overview',      label: 'Overview' },
  { id: 'meaning',       label: 'Meaning',       subtitle: 'STEWARD / ANALYST' },
  { id: 'relationships', label: 'Relationships',  subtitle: '4 SOURCES' },
  { id: 'operations',    label: 'Operations',     subtitle: 'DATA ENGINEER' },
  { id: 'usage',         label: 'Usage',          subtitle: 'T3 · LAST 30 DAYS' },
];

interface InPageNavProps {
  sectionRefs: SectionRefs;
}

export default function InPageNav({ sectionRefs }: InPageNavProps) {
  const [active, setActive] = useState<SectionId>('overview');
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    SECTIONS.forEach(({ id }) => {
      const el = sectionRefs[id].current;
      if (!el) return;

      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActive(id);
          }
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
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <nav
      style={{
        position: 'sticky',
        top: 44,
        zIndex: 19,
        backgroundColor: 'var(--estate-bg, #0D1B2A)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--estate-border-gold, rgba(253,181,21,0.12))',
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        padding: '0 32px',
        height: 42,
      }}
      aria-label="Page sections"
    >
      {SECTIONS.map(({ id, label, subtitle }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => scrollTo(id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              borderBottom: isActive ? '2px solid #FDB515' : '2px solid transparent',
              color: isActive ? '#FDB515' : 'var(--estate-text-secondary, #8892A4)',
              fontFamily: '"Inter Tight", sans-serif',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              transition: 'color 0.15s ease, border-color 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
            {subtitle && (
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10,
                  color: isActive ? 'rgba(253,181,21,0.6)' : 'rgba(136,146,164,0.5)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {subtitle}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
