/**
 * Explicit Stop for a chat turn. Closing the browser tab, switching tabs, or leaving the page
 * drops the HTTP stream; that must not cancel the model. Only this flag does.
 * One Node process (dev server, Elastic Beanstalk instance) shares the map.
 */

const stopped = new Set<string>();

export function turnStopKey(kind: 'inspector' | 'agent', id: string): string {
  return `${kind}:${id}`;
}

export function requestTurnStop(key: string): void {
  if (key) stopped.add(key);
}

export function isTurnStopped(key: string): boolean {
  return key.length > 0 && stopped.has(key);
}

export function clearTurnStop(key: string): void {
  stopped.delete(key);
}
