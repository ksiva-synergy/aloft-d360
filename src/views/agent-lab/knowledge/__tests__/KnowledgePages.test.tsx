// @vitest-environment jsdom
/**
 * Knowledge pages against a fake /api/knowledge: the list groups personal and organisation
 * knowledge bases and offers organisation ones only to admins; a knowledge base shows each
 * document's state in words, uploads files one request each with progress and a result per file
 * (refused files never sent), keeps uploads going across tabs, adds Q&A, and shows search citations.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import KnowledgePage from '../index';
import KnowledgeBasePage from '../detail';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const kb = (over: Record<string, unknown> = {}) => ({
  id: 'kb-1', name: 'Ballast water', description: 'BWM plan and circulars', scope: 'personal', ownerName: 'Ana', mine: true, canManage: true,
  archived: false, documents: 1, pieces: 40, lastIndexedAt: '2026-10-28T09:00:00Z', createdAt: '2026-10-27T09:00:00Z', ...over,
});
const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', kind: 'file', name: 'BWM Plan.pdf', folder: null, version: 1, status: 'indexed', error: null, pages: 34, pieces: 40, ocrPages: 0,
  failedPages: [], sizeBytes: 2_400_000, question: null, answer: null, uploadedByName: 'Ana', createdAt: '2026-10-28T09:00:00Z', indexedAt: null, replacing: false, ...over,
});

type Call = { method: string; path: string; body?: any };
function fakeApi(opts: { list?: object[]; docs?: object[]; isAdmin?: boolean; ready?: boolean } = {}) {
  const docs = [...(opts.docs ?? [])];
  const links: object[] = [{ agentId: 'ag-1', slug: 'qhse-advisor', name: 'QHSE advisor', status: 'live' }];
  const calls: Call[] = [];
  const ctx = { isAdmin: opts.isAdmin ?? false, uploads: { ready: opts.ready ?? true, maxMb: 50 } };
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://test');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const p = url.pathname;
    if (p === '/api/knowledge' && method === 'GET') return json(200, { knowledgeBases: opts.list ?? [], ...ctx });
    if (p === '/api/knowledge' && method === 'POST') return json(201, { knowledgeBase: kb({ id: 'kb-new', name: body.name, scope: body.scope }) });
    if (p === '/api/knowledge/kb-1' && method === 'GET') return json(200, { knowledgeBase: kb(), ...ctx });
    if (p === '/api/knowledge/kb-1/documents') return json(200, { documents: docs });
    if (p === '/api/knowledge/kb-1/qa') {
      docs.push(doc({ id: 'q-1', kind: 'qa', name: body.question, question: body.question, answer: body.answer, status: 'pending' }));
      return json(201, { outcome: 'queued', document: { id: 'q-1', version: 1 } });
    }
    if (p.startsWith('/api/knowledge/kb-1/documents/') && method === 'PATCH') return json(200, { retried: true });
    if (p === '/api/knowledge/kb-1/agents' && method === 'GET')
      return json(200, { links: links.slice(), agents: [{ slug: 'qhse-advisor', name: 'QHSE advisor', status: 'live', description: null }, { slug: 'crew-helper', name: 'Crew helper', status: 'draft', description: null }] });
    if (p === '/api/knowledge/kb-1/agents' && method === 'POST') {
      links.push({ agentId: 'ag-2', slug: body.agentSlug, name: 'Crew helper', status: 'draft' });
      return json(201, { link: links.at(-1) });
    }
    if (p === '/api/knowledge/search')
      return json(200, { results: [{ text: 'The emergency fire pump is tested weekly.', knowledgeBaseId: 'kb-1', documentId: 'd-1', document: 'BWM Plan.pdf', version: 1, section: '4.2 Fire pumps', page: 12, kind: 'file', score: 0.03, matchedBy: 'both' }] });
    return json(404, { error: 'not found' });
  });
  return { calls, docs };
}

/** XHR that the test finishes by hand, so progress and results can be seen in between. */
class FakeXhr {
  static sent: FakeXhr[] = [];
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  status = 0;
  responseText = '';
  url = '';
  form?: FormData;
  open(_m: string, url: string) {
    this.url = url;
  }
  send(form: FormData) {
    this.form = form;
    FakeXhr.sent.push(this);
  }
  finish(status: number, body: unknown) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

const at = (path: string) =>
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          { path: '/agent-lab/knowledge', Component: KnowledgePage },
          { path: '/agent-lab/knowledge/:id', Component: KnowledgeBasePage },
        ],
        { initialEntries: [path] },
      )}
    />,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  FakeXhr.sent = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Knowledge list', () => {
  it('groups personal and organisation knowledge bases and creates a personal one without asking members about scope', async () => {
    const { calls } = fakeApi({ list: [kb(), kb({ id: 'kb-2', name: 'Company SMS', scope: 'org', mine: false, canManage: false })] });
    at('/agent-lab/knowledge');
    const yours = await screen.findByRole('list', { name: 'Yours' });
    expect(within(yours).getByText('Ballast water')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Organisation' })).getByText('Company SMS')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New knowledge base/ }));
    expect(screen.queryByText('Who can use it')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Port state notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ name: 'Port state notes', scope: 'personal' }));
  });

  it('lets admins create an organisation knowledge base and warns when file storage is not set up', async () => {
    fakeApi({ isAdmin: true, ready: false });
    at('/agent-lab/knowledge');
    expect(await screen.findByRole('note')).toHaveProperty('textContent', expect.stringMatching(/KNOWLEDGE_BUCKET/));
    fireEvent.click(screen.getByRole('button', { name: /New knowledge base/ }));
    expect(screen.getByLabelText(/Everyone in the organisation/)).toBeTruthy();
  });
});

describe('A knowledge base', () => {
  it('says what state each document is in, and retries a failed one', async () => {
    const { calls } = fakeApi({
      docs: [
        doc(),
        doc({ id: 'd-2', name: 'Scan.pdf', status: 'indexed', ocrPages: 6, failedPages: [3, 7] }),
        doc({ id: 'd-3', name: 'Circular.docx', status: 'failed', error: 'The file could not be opened' }),
        doc({ id: 'd-4', name: 'Plan v2.pdf', version: 2, status: 'indexing', replacing: true }),
      ],
    });
    at('/agent-lab/knowledge/kb-1');
    const list = await screen.findByRole('list', { name: 'Documents' });
    expect(within(list).getByText('Ready')).toBeTruthy();
    expect(within(list).getByText(/2 pages unread/)).toBeTruthy();
    expect(within(list).getByText(/Pages 3 and 7 could not be read/)).toBeTruthy();
    expect(within(list).getByText('The file could not be opened')).toBeTruthy();
    expect(within(list).getByText(/previous version stays searchable/)).toBeTruthy();
    expect(within(list).getByRole('link', { name: 'Download BWM Plan.pdf' }).getAttribute('href')).toBe('/api/knowledge/kb-1/documents/d-1');
    fireEvent.click(within(list).getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/api/knowledge/kb-1/documents/d-3', body: { retry: true } }));
  });

  it('uploads each file on its own request with a result per file, never sending refused ones, and keeps going across tabs', async () => {
    fakeApi();
    at('/agent-lab/knowledge/kb-1');
    await screen.findByText('Drop files or whole folders here');
    const input = screen.getByTestId('file-input');
    fireEvent.change(input, { target: { files: [new File(['%PDF-1'], 'SMS.pdf'), new File(['x'], 'Old.doc'), new File(['%PDF-2'], 'Fire.pdf')] } });

    const uploads = await screen.findByRole('region', { name: 'Uploads' });
    expect(within(uploads).getByText(/save it as \.docx/)).toBeTruthy();
    await waitFor(() => expect(FakeXhr.sent).toHaveLength(2));
    expect(FakeXhr.sent.map((x) => (x.form!.get('file') as File).name)).toEqual(['SMS.pdf', 'Fire.pdf']);
    expect(FakeXhr.sent[0]!.url).toBe('/api/knowledge/kb-1/documents');

    fireEvent.click(screen.getByRole('tab', { name: /Q&A/ })); // uploads carry on while another tab is open
    FakeXhr.sent[0]!.finish(201, { outcome: 'queued', document: { id: 'x', version: 1 } });
    FakeXhr.sent[1]!.finish(200, { outcome: 'unchanged', document: { id: 'y', version: 1 } });
    fireEvent.click(screen.getByRole('tab', { name: /Documents/ }));
    await waitFor(() => expect(within(uploads).getByText('2 of 3 added, 1 not added')).toBeTruthy());
    expect(within(uploads).getByText('Added')).toBeTruthy();
    expect(within(uploads).getByText('Unchanged')).toBeTruthy();
  });

  it('adds a question and answer', async () => {
    const { calls } = fakeApi();
    at('/agent-lab/knowledge/kb-1');
    fireEvent.click(await screen.findByRole('tab', { name: /Q&A/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add a question and answer/ }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Who signs the ORB?' } });
    fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'The officer in charge; the master signs each page.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/knowledge/kb-1/qa')?.body).toEqual({ question: 'Who signs the ORB?', answer: 'The officer in charge; the master signs each page.' }));
    expect(await screen.findByText('Who signs the ORB?')).toBeTruthy();
  });

  it('searches only this knowledge base and shows where each answer comes from', async () => {
    const { calls } = fakeApi();
    at('/agent-lab/knowledge/kb-1');
    fireEvent.click(await screen.findByRole('tab', { name: /Try a search/ }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'fire pump test' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    const results = await screen.findByRole('list', { name: 'Results' });
    expect(within(results).getByText('page 12')).toBeTruthy();
    expect(within(results).getByText('4.2 Fire pumps')).toBeTruthy();
    expect(within(results).getByRole('link', { name: 'BWM Plan.pdf' }).getAttribute('href')).toBe('/api/knowledge/kb-1/documents/d-1');
    expect(calls.find((c) => c.path === '/api/knowledge/search')?.body).toMatchObject({ question: 'fire pump test', knowledgeBaseIds: ['kb-1'] });
  });

  it('lists the agents that use it, says it stays personal, and adds another', async () => {
    const { calls } = fakeApi();
    at('/agent-lab/knowledge/kb-1');
    fireEvent.click(await screen.findByRole('tab', { name: /Agents/ }));
    const list = await screen.findByRole('list', { name: 'Agents using this knowledge base' });
    expect(within(list).getByText('QHSE advisor')).toBeTruthy();
    expect(screen.getByText(/only people who can see it get answers from it/)).toBeTruthy();
    const pick = screen.getByLabelText('Agent to add') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.value)).toEqual(['', 'crew-helper']); // already linked ones not offered
    fireEvent.change(pick, { target: { value: 'crew-helper' } });
    fireEvent.click(screen.getByRole('button', { name: /Add agent/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/agents'))?.body).toEqual({ agentSlug: 'crew-helper' }));
    expect(await within(list).findByText('Crew helper')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Agents (2)' })).toBeTruthy();
  });
});
