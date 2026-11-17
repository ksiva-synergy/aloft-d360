import { describe, expect, it } from 'vitest';
import { ESTATE_NAV_ITEMS, isEstateItemActive } from '@/lib/estate/nav-items';

const active = (pathname: string) => ESTATE_NAV_ITEMS.filter((item) => isEstateItemActive(item, pathname)).map((item) => item.label);

describe('estate nav active item', () => {
  it('prefers the nested Power BI page over its parent prefix', () => {
    expect(active('/agent-lab/estate/powerbi/report-lineage')).toEqual(['Report lineage']);
    expect(active('/agent-lab/estate/powerbi/source-impact')).toEqual(['Source impact']);
    expect(active('/agent-lab/estate/powerbi')).toEqual(['Power BI']);
    expect(active('/agent-lab/estate/powerbi/reports/r1/lineage')).toEqual(['Power BI']);
  });
});
