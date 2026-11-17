import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { launchHarvesterTask } from './launch-harvester';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('@/lib/aws/ecs-runtime-config', () => ({
  isLocalHarvestRuntime: () => true,
  ecsRuntimeConfig: {},
}));

describe('local harvester launch', () => {
  let child: EventEmitter & { pid?: number; unref: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    child = Object.assign(new EventEmitter(), { pid: 32992, unref: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('runs tsx directly under Node without a Windows shell', async () => {
    const result = launchHarvesterTask(['--kind', 'pbi_parity']);
    child.emit('spawn');
    expect(child.unref).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual({ taskId: 'local-32992', taskArn: 'local://32992' });
    expect(spawn).toHaveBeenCalledWith(process.execPath, [
      expect.stringMatching(/tsx/), '--require', './scripts/context/noserver.cjs',
      'scripts/context/orchestrator.ts', '--kind', 'pbi_parity',
    ], expect.objectContaining({ shell: false, windowsHide: true, detached: true }));
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('reports asynchronous spawn errors instead of recording a task id', async () => {
    const result = launchHarvesterTask([]);
    child.emit('error', new Error('spawn ENOENT'));
    expect(await result).toEqual({ taskId: null, taskArn: null, error: 'spawn ENOENT' });
    expect(child.unref).not.toHaveBeenCalled();
  });

  it('reports an early process exit instead of recording a task id', async () => {
    const result = launchHarvesterTask([]);
    child.emit('spawn');
    child.emit('exit', 1, null);
    expect(await result).toMatchObject({
      taskId: null, error: expect.stringContaining('exited during startup'),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports synchronous spawn failures', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('spawn failed'); });
    expect(await launchHarvesterTask([])).toMatchObject({ taskId: null, error: 'spawn failed' });
  });

  it('reports a missing process id', async () => {
    child.pid = undefined;
    const result = launchHarvesterTask([]);
    child.emit('spawn');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ taskId: null, error: expect.stringContaining('no pid') });
  });
});