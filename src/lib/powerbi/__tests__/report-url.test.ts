import { buildPowerBiReportUrl, isPaginatedReportFormat, resolveReportOpenUrl } from '../report-url';

describe('report-url', () => {
  it('prefers stored web_url', () => {
    expect(
      resolveReportOpenUrl({
        web_url: 'https://app.powerbi.com/groups/ws/reports/rp?ctid=abc',
        pbi_report_id: 'rp',
        workspace_pbi_id: 'ws',
      }),
    ).toEqual({ url: 'https://app.powerbi.com/groups/ws/reports/rp?ctid=abc', synthesized: false });
  });

  it('synthesizes standard report URL', () => {
    expect(resolveReportOpenUrl({ pbi_report_id: 'r-1', workspace_pbi_id: 'w-1' })).toEqual({
      url: 'https://app.powerbi.com/groups/w-1/reports/r-1',
      synthesized: true,
    });
  });

  it('uses rdl path for paginated format', () => {
    expect(buildPowerBiReportUrl('w-1', 'r-1', 'PaginatedReport')).toBe(
      'https://app.powerbi.com/groups/w-1/rdlreports/r-1',
    );
    expect(isPaginatedReportFormat('RDL')).toBe(true);
  });
});