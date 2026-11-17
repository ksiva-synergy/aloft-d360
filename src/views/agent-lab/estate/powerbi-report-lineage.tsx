'use client';

import React from 'react';
import { useParams } from '@/lib/navigation';
import { ReportLineageExplorer } from '@/components/estate/ReportLineageExplorer';

export default function PowerBiReportLineagePage() {
  const params = useParams();
  const reportId = typeof params?.reportId === 'string' ? params.reportId : '';
  if (!reportId) {
    return <p className="p-4 text-caption text-[var(--estate-text-muted)]">Missing report id.</p>;
  }
  return (
    <div className="px-4 py-4">
      <ReportLineageExplorer reportId={reportId} variant="page" />
    </div>
  );
}