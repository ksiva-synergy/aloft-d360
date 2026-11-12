import { describe, expect, it } from 'vitest';
import { openTurn, parseTurnId, requestTurnStop, turnStopKey, waitForTurnIdle } from '../turn-control';

describe('turn-control', () => {
  it('stops only the targeted turn when turn ids are used (Send now)', () => {
    const old = openTurn('inspector', 's1', 'turn-old-0001');
    const fresh = openTurn('inspector', 's1', 'turn-new-0001');
    // A late cancel for the old turn must not stop the new one.
    requestTurnStop(turnStopKey('inspector', 's1', 'turn-old-0001'));
    expect(old.isStopped()).toBe(true);
    expect(fresh.isStopped()).toBe(false);
    old.end();
    fresh.end();
  });

  it('a chat-wide stop reaches a turn that has an id (Stop after page reload)', () => {
    const turn = openTurn('agent', 'c1', 'turn-abc-0001');
    requestTurnStop(turnStopKey('agent', 'c1'));
    expect(turn.isStopped()).toBe(true);
    turn.end();
    // The next turn clears the chat-wide flag.
    const next = openTurn('agent', 'c1', 'turn-abc-0002');
    expect(next.isStopped()).toBe(false);
    next.end();
  });

  it('only the newest turn is current, so an old turn stops writing the draft', () => {
    const old = openTurn('inspector', 's2', 'turn-old-0002');
    expect(old.isCurrent()).toBe(true);
    const fresh = openTurn('inspector', 's2', 'turn-new-0002');
    expect(old.isCurrent()).toBe(false);
    expect(fresh.isCurrent()).toBe(true);
    old.end();
    expect(fresh.isCurrent()).toBe(true);
    fresh.end();
  });

  it('waitForTurnIdle resolves when the running turn ends, or times out', async () => {
    expect(await waitForTurnIdle('agent', 'idle-chat', 10)).toBe(true);
    const turn = openTurn('agent', 'c3', 'turn-wait-001');
    const waiting = waitForTurnIdle('agent', 'c3', 1000);
    turn.end();
    expect(await waiting).toBe(true);
    const stuck = openTurn('agent', 'c4', 'turn-wait-002');
    expect(await waitForTurnIdle('agent', 'c4', 20)).toBe(false);
    stuck.end();
  });

  it('parseTurnId accepts uuids and rejects junk', () => {
    expect(parseTurnId('0b9f7c1e-3c4a-4c1e-9f2a-1d2e3f4a5b6c')).toBeTruthy();
    expect(parseTurnId('short')).toBeUndefined();
    expect(parseTurnId('bad id with spaces')).toBeUndefined();
    expect(parseTurnId(42)).toBeUndefined();
  });
});
