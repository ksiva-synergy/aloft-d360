'use client';

import React from 'react';

export type TrustStatus = 'assumed' | 'confirmed' | 'certified';

interface TrustChipProps {
  status: TrustStatus;
}

export default function TrustChip({ status }: TrustChipProps) {
  let styles = {};

  if (status === 'certified') {
    styles = {
      backgroundColor: '#FDB515',
      borderColor: '#FDB515',
      color: '#0D1B2A',
      fontWeight: 600,
    };
  } else if (status === 'confirmed') {
    styles = {
      backgroundColor: 'var(--estate-trust-confirmed-bg)',
      borderColor: 'var(--estate-trust-confirmed-border)',
      color: 'var(--estate-trust-confirmed-text)',
      fontWeight: 500,
    };
  } else {
    styles = {
      backgroundColor: 'var(--estate-status-default-bg)',
      borderColor: 'var(--estate-status-default-border)',
      color: 'var(--estate-status-default-text)',
      fontWeight: 400,
    };
  }

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border transition-all duration-200"
      style={styles}
    >
      {status}
    </span>
  );
}
