import { describe, expect, it } from 'vitest';
import {
  copyRunnerFlagsToChildScope,
  mergeJobScopeRunnerFlags,
  readJobScopeRunnerFlags,
} from './job-scope-flags';

describe('job-scope-flags', () => {
  it('reads boolean flags from scope', () => {
    expect(readJobScopeRunnerFlags({ forceReprofile: true })).toEqual({
      forceReprofile: true,
      forceReEnrich: false,
      forceFullScan: false,
    });
  });

  it('merges flags into launch scope', () => {
    expect(
      mergeJobScopeRunnerFlags({ includePatterns: ['a.b.*'] }, { forceReEnrich: true }),
    ).toEqual({ includePatterns: ['a.b.*'], forceReEnrich: true });
  });

  it('copies flags into chain child scope', () => {
    expect(
      copyRunnerFlagsToChildScope(
        { forceReprofile: true, chain: ['t2_semantic'] },
        { includePatterns: ['c.d.*'] },
      ),
    ).toMatchObject({ includePatterns: ['c.d.*'], forceReprofile: true });
  });
});
