// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GroupDepartments } from '../GroupDepartments';
import type { AccessGroup } from '../api';

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const group = { id: 'g1', key: 'marine_team', name: 'Marine team', description: null, owners: [], members: [], grants: [] } as AccessGroup;
const DEPARTMENTS = [
  { id: 'd1', key: 'marine', name: 'Marine', description: null, paths: [{ id: 'p1', path: 'curated_db.voyage', depth: 2 }], groups: [{ groupId: 'g1', allowExport: false }] },
  { id: 'd2', key: 'qhse', name: 'QHSE', description: null, paths: [], groups: [] },
];

function stub(calls: { method: string; path: string; body?: unknown }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.pathname === '/api/access/data-departments') return Promise.resolve(json(200, { departments: DEPARTMENTS }));
      calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname === '/api/access/data-departments') return Promise.resolve(json(201, { department: { id: 'd3' } }));
      return Promise.resolve(json(200, { ok: true }));
    }),
  );
}

const show = (readOnly = false) => render(<GroupDepartments group={group} readOnly={readOnly} onChanged={async () => {}} />);

describe('GroupDepartments', () => {
  it('lists the departments the group uses, and offers the others', async () => {
    stub([]);
    show();
    expect(await screen.findByText('Marine')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Marine team access to Marine data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add department' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('changes a department to Use + export without asking for a reason', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    stub(calls);
    show();
    await screen.findByText('Marine');
    expect(screen.queryByLabelText('Reason for department changes')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Use + export' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/access/department-groups', body: { departmentId: 'd1', groupId: 'g1', allowExport: true } });
    vi.unstubAllGlobals();
  });

  it('adds another department', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    stub(calls);
    show();
    await screen.findByText('Marine');
    fireEvent.click(screen.getByRole('button', { name: 'Add department' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/access/department-groups', body: { departmentId: 'd2', groupId: 'g1', allowExport: false } });
    vi.unstubAllGlobals();
  });

  it('creates a new department and adds it in one step', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    stub(calls);
    show();
    await screen.findByText('Marine');
    fireEvent.click(screen.getByRole('combobox', { name: 'Department to add' }));
    fireEvent.click(await screen.findByRole('option', { name: '+ Create a new department' }));
    fireEvent.change(screen.getByLabelText('Department name'), { target: { value: 'Fleet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and add department' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/access/data-departments', body: { key: 'fleet', name: 'Fleet' } });
    expect(calls[1]).toMatchObject({ method: 'PUT', path: '/api/access/department-groups', body: { departmentId: 'd3', groupId: 'g1' } });
    vi.unstubAllGlobals();
  });

  it('is view-only for readers', async () => {
    stub([]);
    show(true);
    await screen.findByText('Marine');
    expect(screen.queryByRole('button', { name: 'Add department' })).toBeNull();
    expect(screen.queryByLabelText('Reason for department changes')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('asks "Sure?" before removing a department, and Cancel backs out', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    stub(calls);
    show();
    await screen.findByText('Marine');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Marine' }));
    expect(screen.getByText('Sure?')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Sure?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Marine' }));
    fireEvent.click(within(screen.getByText('Sure?').parentElement as HTMLElement).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/access/department-groups', body: { departmentId: 'd1', groupId: 'g1' } });
    vi.unstubAllGlobals();
  });
});
