'use client';

import React from 'react';

interface StubPageProps {
  title: string;
  phase: string;
}

export default function StubPage({ title, phase }: StubPageProps) {
  return (
    <div className="h-full w-full flex items-center justify-center p-8 bg-[var(--background)]">
      <div
        className="max-w-md w-full border border-dashed rounded-lg p-10 flex flex-col items-center text-center gap-5 transition-all duration-300 shadow-card"
        style={{
          backgroundColor: 'var(--estate-raised)',
          borderColor: 'var(--estate-border-gold)',
        }}
      >
        {/* Diamond Icon */}
        <span className="w-12 h-12 relative block" style={{ opacity: 0.7 }}>
          <span className="absolute inset-0 border-2 rotate-45" style={{ borderColor: '#FDB515' }} />
          <span className="absolute inset-3.5 border-2 rotate-45 opacity-60" style={{ borderColor: '#FDB515' }} />
        </span>

        {/* Phase Badge */}
        <span
          className="font-mono text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border transition-colors duration-200"
          style={{
            backgroundColor: 'var(--estate-hover)',
            borderColor: 'var(--estate-border-gold)',
            color: '#FDB515',
          }}
        >
          {phase}
        </span>

        {/* Title */}
        <h2 className="text-xl font-serif font-semibold" style={{ color: 'var(--estate-ink)', fontFamily: "'Source Serif 4', serif" }}>
          {title}
        </h2>

        {/* Description */}
        <p className="text-xs leading-relaxed" style={{ color: 'var(--estate-text-secondary)', fontFamily: "'Inter Tight', sans-serif" }}>
          This view is scheduled for a future integration phase. The database models, schemas, and API endpoints are already live in the substrate layer.
        </p>
      </div>
    </div>
  );
}
