import { canRunEstatePipeline, ESTATE_PIPELINE_FORBIDDEN_MESSAGE } from '../pipeline-access';

describe('canRunEstatePipeline', () => {
  it('allows platform_admin only', () => {
    expect(canRunEstatePipeline('platform_admin')).toBe(true);
  });

  it('denies other roles', () => {
    expect(canRunEstatePipeline('admin')).toBe(false);
    expect(canRunEstatePipeline('member')).toBe(false);
    expect(canRunEstatePipeline(null)).toBe(false);
    expect(canRunEstatePipeline(undefined)).toBe(false);
  });

  it('exposes a user-facing forbidden message', () => {
    expect(ESTATE_PIPELINE_FORBIDDEN_MESSAGE).toMatch(/platform admin/i);
  });
});
