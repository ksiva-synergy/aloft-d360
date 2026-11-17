import { describe, expect, it } from 'vitest';

import { copyPbiScope, lockedStages, resolveStages, stageKinds } from '@/lib/powerbi/pipeline-stages';
import { PBI_LINEAGE_KINDS, pbiHarvestLimits, pbiJobScopeFromLaunchBody } from '@/lib/powerbi/launch-scope';

describe('Run pipeline stage selection', () => {
  it('adds the stages that must run together, in run order, with reasons', () => {
    const r = resolveStages(['translate']);
    expect(r.stages).toEqual(['translate', 'oracle', 'parity']);
    expect(r.reasons.parity).toMatch(/Translate/);
    expect(resolveStages(['definitions']).stages).toEqual([
      'definitions',
      'parse',
      'catalog_link',
      'translate',
      'oracle',
      'parity',
    ]);
    expect(resolveStages(['publish']).stages).toEqual(['publish']);
  });

  it('an unparsed model gets harvest stages as prerequisites (definitions only when missing)', () => {
    const noDef = resolveStages(['translate'], { parsed: false, hasDefinition: false });
    expect(noDef.stages).toEqual(['definitions', 'parse', 'catalog_link', 'translate', 'oracle', 'parity']);
    expect(noDef.reasons.parse).toMatch(/not parsed yet/);
    const withDef = resolveStages(['translate'], { parsed: false, hasDefinition: true });
    expect(withDef.stages).toEqual(['parse', 'catalog_link', 'translate', 'oracle', 'parity']);
    expect([...lockedStages(['translate'], { parsed: false, hasDefinition: false })]).toContain('definitions');
    // parsed model: harvest stages stay optional
    expect(resolveStages(['translate'], { parsed: true, hasDefinition: true }).stages).toEqual(['translate', 'oracle', 'parity']);
  });

  it('locks required stages so they cannot be unticked', () => {
    const locked = lockedStages(['translate', 'publish']);
    expect([...locked].sort()).toEqual(['oracle', 'parity']);
    expect(locked.has('publish')).toBe(false);
  });

  it('maps to job kinds for the launch API', () => {
    expect(stageKinds(['oracle', 'publish'])).toEqual(['pbi_oracle', 'pbi_parity', 'pbi_publish']);
  });

  it('keeps the model scope on every chained stage', () => {
    const child = copyPbiScope({ model_ids: ['m1'], oracle_only_translated: true, includePatterns: ['x'] }, {});
    expect(child).toEqual({ model_ids: ['m1'], oracle_only_translated: true });
  });

  it('runs estate lineage without recreation stages or inherited model/report filters', () => {
    expect(PBI_LINEAGE_KINDS).toEqual(['pbi_inventory', 'pbi_definitions', 'pbi_parse', 'pbi_catalog_link']);
    const scope = pbiJobScopeFromLaunchBody({
      pbiAllReports: true, modelIds: ['m1'], reportIds: ['r1'], pbiFetchReports: false,
    });
    expect(scope).toEqual({ all_reports: true, fetch_models: true, fetch_reports: true });
    expect(copyPbiScope(scope, {})).toEqual(scope);
    expect(pbiHarvestLimits(scope)).toEqual({ maxModels: Number.MAX_SAFE_INTEGER, maxReports: Number.MAX_SAFE_INTEGER });
  });

  it('keeps default and explicit limits for ordinary harvest runs', () => {
    expect(pbiHarvestLimits({})).toEqual({ maxModels: undefined, maxReports: undefined });
    expect(pbiHarvestLimits({ max_models: 12, max_reports: 30 })).toEqual({ maxModels: 12, maxReports: 30 });
  });
});
