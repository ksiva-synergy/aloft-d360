// @vitest-environment jsdom
/**
 * Data tab and People & groups tab (simplified model) against a fake /api/access/*.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataView } from '../DataView';
import { PeopleGroupsView } from '../PeopleGroupsView';
import { ConsoleReadOnlyContext } from '../readOnly';
import type { Person } from '../api';

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const people: Person[] = [
  { id: 'u-owner', email: 'owner@x.com', name: 'Olivia Owner', departmentIds: [], clearance: 'internal', directGrants: 0, role: 'member', platformAdmin: false },
  { id: 'u-ana', email: 'ana@x.com', name: 'Ana Rao', departmentIds: [], clearance: 'internal', directGrants: 0, role: 'member', platformAdmin: false },
];

const none = { rules: [], inheritedRules: [], protections: [], inheritedProtections: [], protectedColumns: 0 };
const marineRule = {
  id: 'r1',
  holderType: 'group',
  holderId: 'g1',
  holderName: 'Marine',
  access: 'use',
  autoApprove: false,
  expiresAt: null,
  from: 'curated_db',
};
const restricted = { id: 'p1', tagId: 't-r', name: 'Restricted', from: 'system' };

const ROOT = [
  { path: 'curated_db', name: 'curated_db', depth: 1, kind: 'catalog', childCount: 1, tableCount: 1, inEstate: true, access: { ...none, rules: [marineRule] } },
  { path: 'system', name: 'system', depth: 1, kind: 'catalog', childCount: 0, tableCount: 0, inEstate: true, access: { ...none, protections: [restricted] } },
];
const SCHEMAS = [{ path: 'curated_db.hr', name: 'hr', depth: 2, kind: 'schema', childCount: 1, tableCount: 1, inEstate: true, access: { ...none, inheritedRules: [marineRule] } }];
const TABLES = [{ path: 'curated_db.hr.payroll', name: 'payroll', depth: 3, kind: 'table', childCount: null, tableCount: null, inEstate: true, access: { ...none, inheritedRules: [marineRule], protectedColumns: 1 } }];

const group = {
  id: 'g1',
  key: 'marine',
  name: 'Marine',
  description: null,
  owners: [{ userId: 'u-owner', email: 'owner@x.com', name: 'Olivia Owner' }],
  members: [{ userId: 'u-ana', email: 'ana@x.com', name: 'Ana Rao', expiresAt: null, expired: false, reason: 'crew', addedAt: '' }],
  grants: [],
};

function fakeApi(rootNodes = ROOT) {
  const calls: { method: string; path: string; body?: any }[] = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://test');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    if (method === 'POST' && url.pathname === '/api/access/groups') return json(201, { group: { id: 'g-new', name: body.name } });
    if (method !== 'GET') return json(method === 'POST' ? 201 : 200, { ok: true });
    if (url.pathname === '/api/access/data-tree') {
      const parent = url.searchParams.get('parent');
      return json(200, { nodes: parent === 'curated_db' ? SCHEMAS : parent === 'curated_db.hr' ? TABLES : rootNodes });
    }
    if (url.pathname === '/api/access/data-tree/columns') {
      return json(200, { columns: [{ name: 'salary', type: 'decimal', protections: [{ tagId: 't1', name: 'Compensation' }] }, { name: 'rank', type: 'string', protections: [] }] });
    }
    if (url.pathname === '/api/access/groups') return json(200, { groups: [group] });
    if (url.pathname === '/api/access/tags') return json(200, { tags: [{ id: 't1', key: 'compensation', name: 'Compensation' }, { id: 't-r', key: 'restricted', name: 'Restricted' }] });
    if (url.pathname === '/api/access/rules') return json(200, { rules: [{ id: 'r1', holderName: 'Marine', path: 'curated_db', access: 'use', expiresAt: null }] });
    if (url.pathname === '/api/access/person') {
      return json(200, {
        person: { id: 'u-ana', email: 'ana@x.com', name: 'Ana Rao', roles: ['member'] },
        groups: [{ id: 'g1', name: 'Marine', expiresAt: null }],
        builtins: [{ id: 'readonly', name: 'Everyone' }, { id: 'member', name: 'Members' }],
        rules: [{ path: 'curated_db', access: 'use', through: 'group Marine', expiresAt: null }],
        protections: [{ id: 't1', name: 'Compensation', level: 'none', through: [] }],
      });
    }
    return json(404, { error: 'not found' });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

const renderData = (opts: { readOnly?: boolean; platformAdmin?: boolean } = {}) =>
  render(
    <ConsoleReadOnlyContext.Provider value={opts.readOnly ?? false}>
      <DataView people={people} meId="u-pa" isPlatformAdmin={opts.platformAdmin ?? true} />
    </ConsoleReadOnlyContext.Provider>,
  );

describe('DataView', () => {
  it('lists catalogs with who can use them and a lock for protected ones', async () => {
    fakeApi();
    renderData();
    expect(await screen.findByText('curated_db')).toBeTruthy();
    expect(screen.getByText(/Marine · Use/)).toBeTruthy();
    expect(screen.getByLabelText('Protected')).toBeTruthy();
    expect(screen.getByText('Nobody can use')).toBeTruthy();
  });

  it('warns when nobody can use any catalog', async () => {
    fakeApi(ROOT.map((n) => ({ ...n, access: { ...none } })));
    renderData();
    expect(await screen.findByText(/Nobody can use any catalog yet/)).toBeTruthy();
  });

  it('selecting a catalog shows its access; giving Members Use sends a rule with the reason', async () => {
    const calls = fakeApi();
    renderData();
    fireEvent.click(await screen.findByText('system'));
    const panel = screen.getByRole('region', { name: 'Selected data' });
    expect(within(panel).getByText('No rules on this path yet.')).toBeTruthy();
    expect(within(panel).getByRole('list', { name: 'Summary' }).textContent).toMatch(/Restricted|Whole path/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Give access' }));
    fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'Everyone in ops needs it' } });
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Give access' }).at(-1)!);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        path: '/api/access/rules',
        body: { holderType: 'builtin', holderId: 'readonly', path: 'system', access: 'use', reason: 'Everyone in ops needs it' },
      }),
    );
  });

  it('expanding down to a table shows inherited access and its columns with protections', async () => {
    fakeApi();
    renderData();
    fireEvent.click(await screen.findByLabelText('Expand curated_db'));
    fireEvent.click(await screen.findByLabelText('Expand hr'));
    fireEvent.click(await screen.findByText('payroll'));
    const panel = screen.getByRole('region', { name: 'Selected data' });
    expect(within(panel).getByText('Inherited from above')).toBeTruthy();
    expect(await within(panel).findByText('salary')).toBeTruthy();
    expect(within(panel).getByText('Compensation')).toBeTruthy();
  });

  it('changing a rule asks for a reason, then saves', async () => {
    const calls = fakeApi();
    renderData();
    fireEvent.click(await screen.findByText('curated_db'));
    const panel = screen.getByRole('region', { name: 'Selected data' });
    fireEvent.change(within(panel).getByLabelText('Access for Marine'), { target: { value: 'export' } });
    fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'Monthly crew report' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ body: { holderType: 'group', holderId: 'g1', path: 'curated_db', access: 'export' } }),
    );
  });

  it('read-only viewers see access but cannot change it', async () => {
    fakeApi();
    renderData({ readOnly: true, platformAdmin: false });
    fireEvent.click(await screen.findByText('curated_db'));
    const panel = screen.getByRole('region', { name: 'Selected data' });
    expect(within(panel).queryByRole('button', { name: 'Give access' })).toBeNull();
    expect(within(panel).queryByLabelText('Access for Marine')).toBeNull();
  });
});

describe('PeopleGroupsView', () => {
  const renderPeople = (focusUserId?: string) =>
    render(
      <ConsoleReadOnlyContext.Provider value={false}>
        <PeopleGroupsView people={people} meId="u-pa" isPlatformAdmin focusUserId={focusUserId} onChanged={() => {}} />
      </ConsoleReadOnlyContext.Provider>,
    );

  it('shows a group with approver, members and what it can use', async () => {
    fakeApi();
    renderPeople();
    expect(await screen.findByRole('heading', { name: 'Marine' })).toBeTruthy();
    expect(screen.getByText('Ana Rao')).toBeTruthy();
    expect(await screen.findByText('curated_db')).toBeTruthy();
  });

  it('a person shows their groups, what they can use and why, and what they see as •••', async () => {
    fakeApi();
    renderPeople('u-ana');
    expect(await screen.findByRole('heading', { name: 'Ana Rao' })).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
    expect(screen.getByText(/· group Marine/)).toBeTruthy();
    expect(screen.getByText('Sees ••• for: Compensation')).toBeTruthy();
  });

  it('a new group is created with its approver and people in one step', async () => {
    const calls = fakeApi();
    renderPeople();
    fireEvent.click(await screen.findByRole('button', { name: 'New group' }));
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'HR leads' } });
    fireEvent.change(screen.getByLabelText('Approver'), { target: { value: 'Olivia' } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Approver: matches' })).getByText('Olivia Owner'));
    fireEvent.change(screen.getByLabelText('People in the group'), { target: { value: 'Ana' } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'People in the group: matches' })).getByText('Ana Rao'));
    fireEvent.change(screen.getAllByLabelText('Reason').at(-1)!, { target: { value: 'HR leadership' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/access/groups/g-new/members')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/access/groups')!.body).toMatchObject({ name: 'HR leads', ownerIds: ['u-owner'] });
  });
});
