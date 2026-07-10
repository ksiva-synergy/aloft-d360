'use client';

import React from 'react';

interface FreshnessDotProps {
  stale: boolean;
  size?: number;
}

export default function FreshnessDot({ stale, size = 8 }: FreshnessDotProps) {
  const dotColor = stale ? '#F59E0B' : '#2DD4A0'; // Amber vs Green

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes freshness-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.6);
            opacity: 1;
          }
          50% {
            box-shadow: 0 0 0 6px rgba(245, 158, 11, 0);
            opacity: 0.5;
          }
        }
      `}} />
      <span
        className="inline-block rounded-full shrink-0"
        style={{
          width: size,
          height: size,
          backgroundColor: dotColor,
          animation: stale ? 'freshness-pulse 2s infinite ease-in-out' : 'none',
        }}
        title={stale ? 'Stale: Profile out of sync' : 'Fresh: Profile current'}
      />
    </>
  );
}
