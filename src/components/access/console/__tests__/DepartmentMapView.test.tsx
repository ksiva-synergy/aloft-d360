// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DepartmentMapView } from '../DepartmentMapView';
import { ConsoleReadOnlyContext } from '../readOnly';
import type { Person } from '../api';

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const people: Person[] = [{ id: 'u1', email: 'a@x.com', name: 'Admin', departmentIds: [], clearance: 'internal', directGrants: 0, role: 'admin', platformAdmin: true }];

const ROOT = [
  {
    path: 'curated_db',
    name: 'curated_db',
    depth: 1,
    kind: 'catalog',
    childCount: 0,
    tableCount: 0,
    inEstate: true,
    access: {
      rules: [{ id: 'r1', holderType: 'group', holderId: 'g1', holderName: 'Marine', access: 'use', from: 'curated_db' }],
      inheritedRules: [],
    },
  },
];

describe('DepartmentMapView', () => {
  it('shows department chips on the estate tree', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo) => {
        const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
        if (url.pathname === '/api/access/groups') return Promise.resolve(json(200, { groups: [{ id: 'g1', key: 'marine', name: 'Marine', description: null, owners: [], members: [], grants: [] }] }));
        if (url.pathname === '/api/access/data-tree' && !url.searchParams.get('parent'))
          return Promise.resolve(json(200, { nodes: ROOT }));
        if (url.pathname === '/api/access/rules') return Promise.resolve(json(200, { rules: [{ id: 'r1', holderId: 'g1', path: 'curated_db', access: 'use' }] }));
        return Promise.resolve(json(404, {}));
      }),
    );

    render(
      <ConsoleReadOnlyContext.Provider value={true}>
        <DepartmentMapView people={people} meId="u1" onChanged={async () => {}} />
      </ConsoleReadOnlyContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText(/Marine · Query/)).toBeInTheDocument());
    expect(screen.getByRole('radiogroup', { name: 'Map direction' })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('switches to department → data mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo) => {
        const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
        if (url.pathname === '/api/access/groups') return Promise.resolve(json(200, { groups: [{ id: 'g1', key: 'marine', name: 'Marine', description: null, owners: [], members: [], grants: [] }] }));
        if (url.pathname === '/api/access/data-tree' && !url.searchParams.get('parent'))
          return Promise.resolve(json(200, { nodes: ROOT }));
        if (url.pathname === '/api/access/rules' && url.searchParams.get('holderId') === 'g1')
          return Promise.resolve(json(200, { rules: [{ id: 'r1', path: 'curated_db', access: 'use' }] }));
        if (url.pathname === '/api/access/rules') return Promise.resolve(json(200, { rules: [{ id: 'r1', holderId: 'g1', path: 'curated_db', access: 'use' }] }));
        return Promise.resolve(json(404, {}));
      }),
    );

    render(
      <ConsoleReadOnlyContext.Provider value={true}>
        <DepartmentMapView people={people} meId="u1" onChanged={async () => {}} />
      </ConsoleReadOnlyContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText('curated_db')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'Department → data' }));
    await waitFor(() => expect(screen.getByText(/Mapped to Marine/)).toBeInTheDocument());

    vi.unstubAllGlobals();
  });
});
