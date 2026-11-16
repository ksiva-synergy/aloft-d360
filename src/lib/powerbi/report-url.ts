/** Power BI Service → browser report URLs when harvest did not store `webUrl`. */

const PBI_APP = 'https://app.powerbi.com';

export function isPaginatedReportFormat(format: string | null | undefined): boolean {
  if (!format) return false;
  const f = format.toLowerCase();
  return f.includes('paginated') || f.includes('rdl');
}

export function buildPowerBiReportUrl(
  workspacePbiId: string,
  reportPbiId: string,
  reportFormat?: string | null,
): string {
  const ws = encodeURIComponent(workspacePbiId);
  const rp = encodeURIComponent(reportPbiId);
  if (isPaginatedReportFormat(reportFormat)) {
    return `${PBI_APP}/groups/${ws}/rdlreports/${rp}`;
  }
  return `${PBI_APP}/groups/${ws}/reports/${rp}`;
}

export type ReportUrlInput = {
  web_url?: string | null;
  pbi_report_id?: string | null;
  report_format?: string | null;
  workspace_pbi_id?: string | null;
};

/** Prefer stored service URL; otherwise build a standard app.powerbi.com deep link. */
export function resolveReportOpenUrl(input: ReportUrlInput): { url: string; synthesized: boolean } | null {
  const stored = input.web_url?.trim();
  if (stored) return { url: stored, synthesized: false };

  const ws = input.workspace_pbi_id?.trim();
  const id = input.pbi_report_id?.trim();
  if (!ws || !id) return null;

  return {
    url: buildPowerBiReportUrl(ws, id, input.report_format),
    synthesized: true,
  };
}