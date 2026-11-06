/**
 * Knowledge for agents: an agent searches only the linked knowledge bases the person running it may
 * search (a colleague's personal one never), ids the model makes up are ignored, results come back
 * clipped with a ready citation, and only whoever manages a knowledge base can link agents to it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';

const h = vi.hoisted(() => ({ links: [] as object[], search: vi.fn(), audit: vi.fn(), upsert: vi.fn(), load: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    knowledge_source_agents: { findMany: async () => h.links, upsert: h.upsert, deleteMany: async () => ({ count: 1 }) },
    agent_catalog: { findFirst: async ({ where }: { where: { slug: string } }) => (where.slug === 'qhse-advisor' ? { id: 'ag-1', slug: 'qhse-advisor', name: 'QHSE advisor', status: 'live' } : null) },
  },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: h.audit }));
vi.mock('../search', () => ({ searchKnowledge: h.search }));
vi.mock('../embed', () => ({ embedQuestion: vi.fn() }));
vi.mock('../repo', () => ({ prismaKnowledgeRepo: {} }));
vi.mock('../service', () => ({ loadKnowledgeBase: h.load }));

import { citeAs, knowledgeForAgent, knowledgePrompt, linkAgent, runSearchKnowledgeTool } from '../agents';

const kb = (id: string, over: object = {}) => ({ source: { id, org_id: 'org-1', name: id.toUpperCase(), description: null, scope: 'org', owner_id: 'u-admin', archived_at: null, type: 'FILE', ...over } });
const ana = { userId: 'u-ana', role: 'member', orgId: 'org-1' };

beforeEach(() => {
  h.search.mockReset().mockResolvedValue([]);
  h.upsert.mockReset().mockResolvedValue({ bound_at: new Date('2026-10-28T10:00:00Z') });
  h.load.mockReset();
});

describe('what an agent may search', () => {
  it('is the linked knowledge bases the person may search: organisation ones, their own, never a colleague’s or an archived one', async () => {
    h.links = [kb('sms'), kb('mine', { scope: 'personal', owner_id: 'u-ana' }), kb('bens', { scope: 'personal', owner_id: 'u-ben' }), kb('old', { archived_at: new Date() }), kb('other-org', { org_id: 'org-2' })];
    expect((await knowledgeForAgent('ag-1', ana, 'org-1')).map((k) => k.id)).toEqual(['mine', 'sms']);
    // No person (service token): organisation knowledge bases only.
    expect((await knowledgeForAgent('ag-1', null, 'org-1')).map((k) => k.id)).toEqual(['sms']);
  });

  it('tells the agent to cite, only when it has knowledge', () => {
    expect(knowledgePrompt([])).toBe('');
    expect(knowledgePrompt([{ id: 'sms', name: 'Company SMS', description: null }])).toMatch(/search "Company SMS".*\n.*\(document, page\)/s);
  });
});

describe('the search tool', () => {
  const kbs = [
    { id: 'sms', name: 'Company SMS', description: null },
    { id: 'bwm', name: 'Ballast water', description: null },
  ];

  it('ignores knowledge base ids the model invents and searches what it may', async () => {
    await runSearchKnowledgeTool({ question: 'fire pump', knowledgeBaseIds: ['bens-private', 'bwm'] }, kbs, { orgId: 'org-1', userId: 'u-ana', surface: 'agent' });
    expect(h.search.mock.calls[0]![0]).toMatchObject({ sourceIds: ['bwm'], userId: 'u-ana', surface: 'agent', limit: 5 });
    await runSearchKnowledgeTool({ question: 'fire pump', knowledgeBaseIds: ['bens-private'], limit: 50 }, kbs, { orgId: 'org-1', userId: 'u-ana', surface: 'agent' });
    expect(h.search.mock.calls[1]![0]).toMatchObject({ sourceIds: ['sms', 'bwm'], limit: 8 });
  });

  it('returns clipped passages with a ready citation, and says so when nothing matches', async () => {
    expect(JSON.parse(await runSearchKnowledgeTool({ question: 'x' }, kbs, { orgId: 'org-1', userId: null, surface: 'automation' }))).toMatchObject({ error: expect.any(String) });
    expect(JSON.parse(await runSearchKnowledgeTool({ question: 'nothing here' }, kbs, { orgId: 'org-1', userId: null, surface: 'automation' }))).toMatchObject({ results: [], note: expect.stringMatching(/could not find/) });
    h.search.mockResolvedValue([{ text: 'a'.repeat(2000), knowledgeBaseId: 'sms', documentId: 'd', document: 'SMS Manual.pdf', version: 1, section: '4.2 Fire pumps', page: 12, kind: 'file', score: 1, matchedBy: 'both' }]);
    const out = JSON.parse(await runSearchKnowledgeTool({ question: 'fire pump' }, kbs, { orgId: 'org-1', userId: null, surface: 'automation' }));
    expect(out.results[0]).toMatchObject({ n: 1, cite: 'SMS Manual.pdf, p. 12, 4.2 Fire pumps', knowledgeBase: 'Company SMS' });
    expect(out.results[0].text).toHaveLength(1501);
    expect(citeAs({ kind: 'qa' } as never)).toBe('Q&A');
  });
});

describe('linking agents', () => {
  it('needs the right to manage the knowledge base and an agent that exists', async () => {
    h.load.mockRejectedValueOnce(new ApiError(403, 'Only admins can change an organisation knowledge base'));
    await expect(linkAgent(ana, 'sms', 'qhse-advisor')).rejects.toMatchObject({ status: 403 });
    h.load.mockResolvedValue({ archived_at: null });
    await expect(linkAgent(ana, 'mine', 'nobody')).rejects.toMatchObject({ status: 404 });
    const link = await linkAgent(ana, 'mine', 'qhse-advisor');
    expect(link).toMatchObject({ agentId: 'ag-1', name: 'QHSE advisor' });
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ source_id: 'mine', agent_id: 'ag-1', bound_by: 'u-ana' }) }));
    expect(h.load).toHaveBeenLastCalledWith(ana, 'mine', 'manage');
  });
});
