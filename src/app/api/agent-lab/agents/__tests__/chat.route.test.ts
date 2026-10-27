/**
 * Agent chat after moving the run into the shared runner: the HTTP errors it returned before still
 * come back before the stream starts, and the stream carries the same events (text, tool events,
 * done with usage). The runner is a fake here; run-catalog-agent.test.ts covers the run itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ findFirst: vi.fn(), runCatalogAgent: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: { agent_catalog: { findFirst: h.findFirst } } }));
vi.mock('@/lib/inspector/session-auth', () => ({ guardInspectorChat: async () => null }));
vi.mock('@/lib/inspector/llm-configured', () => ({ inspectorLlmConfigured: () => true }));
vi.mock('@/lib/construction/catalog-sync', () => ({ runtimeBriefFromCatalog: (a: { config?: { noBrief?: boolean } }) => (a.config?.noBrief ? null : { name: 'x' }) }));
vi.mock('@/lib/construction/workbench-model', () => ({ resolveWorkbenchModel: () => ({ effectiveModelId: 'm-1' }) }));
vi.mock('@/lib/inspector/session-role', () => ({ getSessionUserRole: async () => 'member' }));
vi.mock('@/lib/agents/run-catalog-agent', () => ({ runCatalogAgent: h.runCatalogAgent }));

import { POST } from '../chat/route';

const post = (body: unknown) =>
  POST(new Request('http://test/api/agent-lab/agents/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);

beforeEach(() => {
  h.findFirst.mockReset().mockResolvedValue({ id: 'cat-1', name: 'Regulatory Decision Tracer', config: {} });
  h.runCatalogAgent.mockReset();
});

describe('agent chat', () => {
  it('keeps its HTTP errors for a missing agent or one without instructions', async () => {
    h.findFirst.mockResolvedValueOnce(null);
    expect((await post({ slug: 'nope', message: 'hi' })).status).toBe(404);
    h.findFirst.mockResolvedValueOnce({ id: 'c', name: 'n', config: { noBrief: true } });
    expect((await post({ slug: 's', message: 'hi' })).status).toBe(400);
    expect(h.runCatalogAgent).not.toHaveBeenCalled();
  });

  it('streams the run from the shared runner and records it as agent_use', async () => {
    h.runCatalogAgent.mockImplementation(async (input: { onTextChunk: (d: string) => void; onToolEvent: (e: object) => void }) => {
      input.onToolEvent({ type: 'query_result', rows: [] });
      input.onTextChunk('Hello');
      return { outcome: 'completed', loops: 2, usage: { inputTokens: 10, outputTokens: 2 }, model: 'm-1' };
    });
    const res = await post({ slug: 'regulatory-decision-tracer', message: 'hi', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }] });
    const text = await res.text();
    const events = text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
    expect(events.map((e) => e.type)).toEqual(['stream_start', 'query_result', 'text', 'done']);
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'completed', loops: 2, usage: { inputTokens: 10, outputTokens: 2 }, model: 'm-1' });
    expect(h.runCatalogAgent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'regulatory-decision-tracer', message: 'hi', surface: 'agent_use', role: 'member', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }] }),
    );
  });
});
