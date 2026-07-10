'use client';

import React from 'react';
import { Modal } from '@/components/ui/modal';
import { Database } from 'lucide-react';

export interface ScanCoverageCatalog {
  catalog_name: string;
  databricks_count: number;
  aurora_count: number;
  missing: number;
  is_new: boolean;
  status: string;
}

export interface ScanCoverageResult {
  catalogs: ScanCoverageCatalog[];
  totals: { databricks: number; aurora: number; missing: number };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  data: ScanCoverageResult | null;
  loading: boolean;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function ScanCoverageModal({ isOpen, onClose, data, loading }: Props) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Estate Coverage Scan"
      description="Databricks catalog objects vs. Aurora (synced)"
      icon={<Database />}
      maxWidth="3xl"
      className="!bg-[#0D1B2A] !border !border-[rgba(253,181,21,0.2)]"
      headerClassName="!border-[rgba(253,181,21,0.15)]"
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4 animate-pulse">
              <div className="h-5 bg-slate-400/10 rounded flex-[2]" />
              <div className="h-5 bg-slate-400/10 rounded flex-1" />
              <div className="h-5 bg-slate-400/10 rounded flex-1" />
              <div className="h-5 bg-slate-400/10 rounded flex-1" />
            </div>
          ))}
        </div>
      ) : data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: 'rgba(253,181,21,0.2)' }}
              >
                <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#8892A4' }}>
                  Catalog
                </th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#8892A4' }}>
                  Databricks
                </th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#8892A4' }}>
                  Aurora
                </th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#8892A4' }}>
                  Missing
                </th>
              </tr>
            </thead>
            <tbody>
              {data.catalogs.map((row) => (
                <tr
                  key={row.catalog_name}
                  className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: 'rgba(253,181,21,0.08)' }}
                >
                  <td className="py-2.5 px-3 flex items-center gap-2" style={{ color: '#FFFFFF' }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {row.catalog_name}
                    </span>
                    {row.is_new && (
                      <span
                        className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: '#3f2a00', color: '#FDB515' }}
                      >
                        new
                      </span>
                    )}
                  </td>
                  <td
                    className="text-right py-2.5 px-3"
                    style={{ color: '#FFFFFF', fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    {row.databricks_count > 0 ? formatNumber(row.databricks_count) : '—'}
                  </td>
                  <td
                    className="text-right py-2.5 px-3"
                    style={{ color: '#FFFFFF', fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    {row.aurora_count > 0 ? formatNumber(row.aurora_count) : '—'}
                  </td>
                  <td
                    className="text-right py-2.5 px-3 font-semibold"
                    style={{
                      color: row.missing > 0 ? '#FDB515' : '#8892A4',
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    {row.missing > 0 ? formatNumber(row.missing) : '0'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr
                className="border-t-2"
                style={{ borderColor: 'rgba(253,181,21,0.3)' }}
              >
                <td
                  className="py-3 px-3 font-bold text-xs uppercase tracking-wider"
                  style={{ color: '#FFFFFF' }}
                >
                  Total
                </td>
                <td
                  className="text-right py-3 px-3 font-bold"
                  style={{ color: '#FFFFFF', fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  {formatNumber(data.totals.databricks)}
                </td>
                <td
                  className="text-right py-3 px-3 font-bold"
                  style={{ color: '#FFFFFF', fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  {formatNumber(data.totals.aurora)}
                </td>
                <td
                  className="text-right py-3 px-3 font-bold"
                  style={{ color: '#FDB515', fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  {formatNumber(data.totals.missing)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Summary line */}
          <p
            className="mt-4 text-xs"
            style={{ color: '#8892A4', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            {formatNumber(data.totals.missing)} objects missing from Aurora
            {data.catalogs.some(c => c.is_new) && (
              <span style={{ color: '#FDB515' }}>
                {' '}· {data.catalogs.filter(c => c.is_new).length} new catalog{data.catalogs.filter(c => c.is_new).length > 1 ? 's' : ''} discovered
              </span>
            )}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
