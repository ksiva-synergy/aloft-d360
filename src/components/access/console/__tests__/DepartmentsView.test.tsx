// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DepartmentsView } from '../DepartmentsView';
import { ConsoleReadOnlyContext } from '../readOnly';

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const view = <DepartmentsView />;

const member = { userId: 'u9', name: 'Ana', email: 'ana@x.com', expired: false };
const GROUPS = [
  { id: 'g1', key: 'marine_team', name: 'Marine team', description: null, owners: [], members: [member], grants: [] },
  { id: 'g2', key: 'qhse_team', name: 'QHSE team', description: null, owners: [], members: [], grants: [] },
];
const node = (path: string, depth: 1 | 2 | 3, childCount: number | null) => ({ path, name: path.split('.').pop(), depth, kind: depth === 3 ? 'table' : depth === 2 ? 'schema' : 'catalog', childCount });

function stubApi(calls: { method: string; path: string; body?: unknown }[]) {
  const department = {
    id: 'd1',
    key: 'marine',
    name: 'Marine',
    description: null,
    paths: [{ id: 'p1', path: 'curated_db.voyage', depth: 2 }],
    groups: [{ groupId: 'g1', allowExport: false }],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname === '/api/access/data-departments' && method === 'GET') return Promise.resolve(json(200, { departments: [department] }));
      if (url.pathname === '/api/access/groups' && method === 'GET') return Promise.resolve(json(200, { groups: GROUPS }));
      if (url.pathname === '/api/access/data-tree') {
        const parent = url.searchParams.get('parent');
        if (!parent) return Promise.resolve(json(200, { nodes: [node('curated_db', 1, 1)] }));
        if (parent === 'curated_db') return Promise.resolve(json(200, { nodes: [node('curated_db.voyage', 2, 1), node('curated_db.crew', 2, 0)] }));
      }
      if (url.pathname === '/api/access/data-departments' && method === 'POST') return Promise.resolve(json(201, { department: { id: 'd2' } }));
      if (url.pathname === '/api/access/groups' && method === 'POST') return Promise.resolve(json(201, { group: { id: 'g3' } }));
      if (method !== 'GET') return Promise.resolve(json(200, { ok: true }));
      return Promise.resolve(json(404, {}));
    }),
  );
}

describe('DepartmentsView', () => {
  it('shows what belongs to a department and which groups use it', async () => {
    stubApi([]);
    render(
      <ConsoleReadOnlyContext.Provider value={false}>
        {view}
      </ConsoleReadOnlyContext.Provider>,
    );
    expect(await screen.findByText('Data that belongs to Marine')).toBeInTheDocument();
    expect(screen.getAllByText('curated_db.voyage').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 item.* belong here · used by Marine team/)).toBeInTheDocument();
    // Who may use it is not edited here.
    expect(screen.queryByRole('radiogroup', { name: /access to Marine data/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Link group/ })).toBeNull();
    // The tree is not on the page until Add data is pressed.
    expect(screen.queryByRole('button', { name: 'Open curated_db' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('adds a schema from the Add data dialog, without asking for a reason', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    stubApi(calls);
    render(
      <ConsoleReadOnlyContext.Provider value={false}>
        {view}
      </ConsoleReadOnlyContext.Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add data' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open curated_db' }));
    const add = await screen.findByRole('button', { name: 'Add curated_db.crew' });
    // The schema that already belongs shows as such and cannot be added again.
    expect(screen.getByText('Belongs')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reason for adding data')).toBeNull();
    fireEvent.click(add);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/access/department-paths')).toBe(true));
    expect(calls.find((c) => c.path === '/api/access/department-paths')?.body).toMatchObject({ departmentId: 'd1', path: 'curated_db.crew' });
    vi.unstubAllGlobals();
  });

  it('is view-only for readers', async () => {
    stubApi([]);
    render(
      <ConsoleReadOnlyContext.Provider value={true}>
        {view}
      </ConsoleReadOnlyContext.Provider>,
    );
    await screen.findByText('Data that belongs to Marine');
    expect(screen.queryByRole('button', { name: /Link group/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add data' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('creates a department with just a name', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    stubApi(calls);
    render(
      <ConsoleReadOnlyContext.Provider value={false}>
        {view}
      </ConsoleReadOnlyContext.Provider>,
    );
    await screen.findByText('Data that belongs to Marine');
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    const list = screen.getByRole('complementary', { name: 'Departments' });
    fireEvent.change(within(list).getByLabelText('Department name'), { target: { value: 'Fleet' } });
    expect(within(list).queryByLabelText('Reason')).toBeNull();
    // No group fields here: groups are managed on People & groups.
    expect(within(list).queryByLabelText('Group name')).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/access/data-departments', body: { key: 'fleet', name: 'Fleet' } });
    vi.unstubAllGlobals();
  });
});
