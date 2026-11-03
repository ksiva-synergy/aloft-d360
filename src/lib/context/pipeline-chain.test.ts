import { describe, expect, it } from 'vitest';
import {
  copyPipelineChainMetadata,
  shouldAdvanceChainAfterT3,
} from '@/lib/context/pipeline-chain';

describe('pipeline-chain', () => {
  it('copyPipelineChainMetadata copies chain, pipeline_run_id, ui_surface', () => {
    const onto: Record<string, unknown> = {};
    copyPipelineChainMetadata(
      {
        chain: ['t4_scan'],
        pipeline_run_id: '8942f51f-c06e-44d1-8311-c67ea1049d7e',
        ui_surface: 'scanned_continue',
      },
      onto,
    );
    expect(onto.chain).toEqual(['t4_scan']);
    expect(onto.pipeline_run_id).toBe('8942f51f-c06e-44d1-8311-c67ea1049d7e');
    expect(onto.ui_surface).toBe('scanned_continue');
  });

  it('shouldAdvanceChainAfterT3 requires snapshots when objects were in scope', () => {
    const chainScope = { chain: ['t4_scan'] };
    expect(
      shouldAdvanceChainAfterT3({ objectsInScope: 1, snapshotsWritten: 0 }, chainScope),
    ).toBe(false);
    expect(
      shouldAdvanceChainAfterT3({ objectsInScope: 1, snapshotsWritten: 2 }, chainScope),
    ).toBe(true);
    expect(
      shouldAdvanceChainAfterT3({ objectsInScope: 0, snapshotsWritten: 0 }, chainScope),
    ).toBe(true);
    expect(shouldAdvanceChainAfterT3({ objectsInScope: 1, snapshotsWritten: 0 }, {})).toBe(false);
  });
});
