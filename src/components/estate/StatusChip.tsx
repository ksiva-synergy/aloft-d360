'use client';

import React from 'react';

interface StatusChipProps {
  status: string;
}

export default function StatusChip({ status }: StatusChipProps) {
  const lowerStatus = status.toLowerCase();

  let styles = {};

  if (lowerStatus === 'active' || lowerStatus === 'live' || lowerStatus === 'completed' || lowerStatus === 'success') {
    styles = {
      backgroundColor: 'var(--estate-status-success-bg)',
      borderColor: 'var(--estate-status-success-border)',
      color: 'var(--estate-status-success-text)',
    };
  } else if (lowerStatus === 'deprecated' || lowerStatus === 'failed' || lowerStatus === 'error') {
    styles = {
      backgroundColor: 'var(--estate-status-error-bg)',
      borderColor: 'var(--estate-status-error-border)',
      color: 'var(--estate-status-error-text)',
    };
  } else if (lowerStatus === 'stale' || lowerStatus === 'warning' || lowerStatus === 'pending') {
    styles = {
      backgroundColor: 'var(--estate-status-warning-bg)',
      borderColor: 'var(--estate-status-warning-border)',
      color: 'var(--estate-status-warning-text)',
    };
  } else {
    styles = {
      backgroundColor: 'var(--estate-status-default-bg)',
      borderColor: 'var(--estate-status-default-border)',
      color: 'var(--estate-status-default-text)',
    };
  }

  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border transition-all duration-200"
      style={styles}
    >
      {status}
    </span>
  );
}
