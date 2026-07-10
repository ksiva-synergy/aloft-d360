'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import CoverageBar from './CoverageBar';

interface CoverageItem {
  label: string;
  count: number;
  color: string;
  denominator?: number;
}

interface SourceCardProps {
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  catalogName: string;
  totalObjects: number;
  estateTotal: number;
  lastSweep: string;
  queuedJobs: number;
  staleObjects: number;
  coverage: CoverageItem[];
}

export default function SourceCard({
  sourceId,
  sourceName,
  sourceKind,
  catalogName,
  totalObjects,
  estateTotal,
  lastSweep,
  queuedJobs,
  staleObjects,
  coverage,
}: SourceCardProps) {
  const [harvesting, setHarvesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const cardBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';
  const raisedBg = 'var(--estate-hover)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const inkColor = 'var(--estate-ink)';

  const isBtnDisabled = harvesting || refreshing;

  const handleHarvest = async () => {
    setHarvesting(true);
    try {
      const res = await fetch(`/api/agent-lab/context/sources/${sourceId}/harvest`, {
        method: 'POST',
      });
      if (res.status === 202) {
        toast.success('Harvest queued');
      } else {
        toast.error('Failed to queue harvest');
      }
    } catch (err) {
      toast.error('Failed to request harvest');
    } finally {
      setHarvesting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/agent-lab/context/sources/${sourceId}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 || (res.status === 200 && data.queued)) {
        toast.success('Profile refresh queued');
      } else if (data.reason === 'debounced' || !data.queued) {
        toast.info('Refresh already in progress');
      } else {
        toast.error('Failed to queue profile refresh');
      }
    } catch (err) {
      toast.error('Failed to request profile refresh');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      className="border-t-[3px] rounded border transition-all duration-300 p-5 shadow-card"
      style={{
        backgroundColor: cardBg,
        borderColor: borderColor,
        borderTopColor: '#FDB515',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--estate-btn-border)';
        e.currentTarget.style.borderTopColor = '#FDB515';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--estate-border-gold)';
        e.currentTarget.style.borderTopColor = '#FDB515';
      }}
    >
      {/* Header Info */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold transition-colors duration-200" style={{ color: inkColor }}>
            {sourceName}
          </h3>
          <span
            className="font-mono text-[10px] tracking-wider uppercase px-2 py-0.5 rounded border mt-1.5 inline-block transition-colors duration-200"
            style={{
              backgroundColor: raisedBg,
              borderColor: borderColor,
              color: labelColor,
            }}
          >
            {sourceKind}
          </span>
        </div>
        <div className="font-mono text-[10px] text-right leading-relaxed" style={{ color: mutedColor }}>
          {estateTotal} objects
          <br />
          {catalogName}
        </div>
      </div>

      {/* Coverage Progress Bars */}
      <div className="flex flex-col gap-3.5 mt-5">
        {coverage.map((item) => (
          <CoverageBar
            key={item.label}
            label={item.label}
            count={item.count}
            total={estateTotal}
            color={item.color}
            denominator={item.denominator}
          />
        ))}
      </div>

      {/* Stats Row */}
      <div
        className="flex items-center gap-3.5 mt-5 font-mono text-[10px] flex-wrap transition-colors duration-200"
        style={{ color: mutedColor }}
      >
        <span title="Most recent estate inventory sweep across all catalog objects">
          Last sweep: <span style={{ color: labelColor }}>{lastSweep}</span>
        </span>
        <span className="opacity-40">•</span>
        <span>
          <span style={{ color: '#FDB515', fontWeight: 600 }}>{queuedJobs}</span> queued
        </span>
        <span className="opacity-40">•</span>
        <span title="Objects not inventoried in the last 7 days">
          <span style={{ color: '#F59E0B', fontWeight: 600 }}>{staleObjects}</span> stale
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2.5 mt-5">
        <button
          type="button"
          onClick={handleHarvest}
          disabled={isBtnDisabled}
          className="font-mono text-[11px] font-semibold tracking-wider uppercase border rounded px-3.5 py-2 cursor-pointer transition-all duration-200 disabled:opacity-50 flex items-center gap-2"
          style={{
            borderColor: '#FDB515',
            color: '#FDB515',
            backgroundColor: 'transparent',
          }}
          onMouseEnter={(e) => {
            if (!isBtnDisabled) e.currentTarget.style.backgroundColor = 'rgba(253, 181, 21, 0.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {harvesting && <RefreshCw size={12} className="animate-spin" />}
          {harvesting ? 'Harvesting...' : 'Harvest Now'}
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isBtnDisabled}
          className="font-mono text-[11px] font-semibold tracking-wider uppercase border rounded px-3.5 py-2 cursor-pointer transition-all duration-200 disabled:opacity-50 flex items-center gap-2"
          style={{
            borderColor: 'var(--estate-border-gold)',
            color: labelColor,
            backgroundColor: 'transparent',
          }}
          onMouseEnter={(e) => {
            if (!isBtnDisabled) {
              e.currentTarget.style.borderColor = 'var(--estate-btn-border)';
              e.currentTarget.style.color = 'var(--estate-ink)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--estate-border-gold)';
            e.currentTarget.style.color = 'var(--estate-text-secondary)';
          }}
        >
          {refreshing && <RefreshCw size={12} className="animate-spin" />}
          {refreshing ? 'Refreshing...' : 'Refresh Profiles'}
        </button>
      </div>
    </div>
  );
}
