// @vitest-environment jsdom
/**
 * Column access, protections first: the list of protections, a protection's columns, adding columns
 * by search, new protections (people or a group), removing and moving columns, and the who-can-see
 * dialog (people, approvers, giving access).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColumnAccessView } from '../ColumnAccessView';
import { ConsoleReadOnlyContext } from '../readOnly';
import type { Person } from '../api';

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const people: Person[] = [
  { id: 'u-owner', email: 'owner@x.com', name: 'Olivia Owner', departmentIds: [], clearance: 'internal', directGrants: 0, role: 'member', platformAdmin: false },
  { id: 'u-ana', email: 'ana@x.com', name: 'Ana Rao', departmentIds: [], clearance: 'internal', directGrants: 0, role: 'member', platformAdmin: false },
  { id: 'u-ben', email: 'ben@x.com', name: 'Ben Ko', departmentIds: [], clearance: 'internal', directGrants: 0, role: 'member', platformAdmin: false },
];

const salary = { id: 't1', key: 'salary', name: 'Salary', description: null, requiresTwoApprovals: false, maxDurationDays: null };
const contact = { id: 't2', key: 'contact', name: 'Contact details', description: null, requiresTwoApprovals: false, maxDurationDays: null };
const grant = { id: 'g1', tagId: 't1', principalType: 'group', principalId: 'grp1', level: 'full', expiresAt: null, reason: 'x', createdAt: '2026-11-07T00:00:00Z' };
const group = {
  id: 'grp1',
  key: 'payroll',
  name: 'Payroll team',
  description: null,
  owners: [{ userId: 'u-owner', email: 'owner@x.com', name: 'Olivia Owner' }],
  members: [{ userId: 'u-ana', email: 'ana@x.com', name: 'Ana Rao', expiresAt: null, expired: false, reason: 'payroll clerk', addedAt: '2026-11-07T00:00:00Z' }],
  grants: [grant],
};
const colTags = [
  { id: 'c1', tablePath: 'curated.crew.contracts', column: 'salary_amount', tagId: 't1', status: 'confirmed', source: 'steward', reason: 'pay', setBy: 'u', updatedAt: '' },
  { id: 'c2', tablePath: 'curated.hr.users', column: 'email', tagId: 't2', status: 'confirmed', source: 'steward', reason: 'contact', setBy: 'u', updatedAt: '' },
];

function fakeApi() {
  const calls: { method: string; path: string; body?: any }[] = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://test');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    if (method === 'POST' && url.pathname === '/api/access/tags') return json(201, { tag: { ...salary, id: 't-new', name: body.name } });
    if (method === 'POST' && url.pathname === '/api/access/groups') return json(201, { group: { id: 'grp-new', key: 'x', name: body.name } });
    if (method !== 'GET') return json(method === 'POST' ? 201 : 204, { ok: true });
    if (url.pathname === '/api/access/tags') return json(200, { tags: [salary, contact] });
    if (url.pathname === '/api/access/groups') return json(200, { groups: [group] });
    if (url.pathname === '/api/access/tag-grants') return json(200, { grants: [grant] });
    if (url.pathname === '/api/access/column-tags') return json(200, { columnTags: colTags });
    if (url.pathname === '/api/access/path-protections') return json(200, { pathProtections: [{ tagId: 't1', path: 'curated.finance' }] });
    if (url.pathname === '/api/access/column-search') {
      return json(200, {
        truncated: false,
        columns: [
          { tablePath: 'curated.crew.contracts', column: 'salary_amount', type: 'decimal', kind: 'table', tagIds: ['t1'] },
          { tablePath: 'curated.hr.payroll', column: 'base_salary', type: 'decimal', kind: 'table', tagIds: [] },
          { tablePath: 'scratch.hr.v_costs', column: 'salary_total', type: 'decimal', kind: 'view', tagIds: ['t2'] },
        ],
      });
    }
    return json(404, { error: 'not found' });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

function renderPage(opts: { platformAdmin?: boolean; readOnly?: boolean; meId?: string } = {}) {
  return render(
    <ConsoleReadOnlyContext.Provider value={opts.readOnly ?? false}>
      <ColumnAccessView people={people} meId={opts.meId ?? 'u-pa'} isPlatformAdmin={opts.platformAdmin ?? true} onChanged={() => {}} />
    </ConsoleReadOnlyContext.Provider>,
  );
}

/** Inline people picker: type, then click the match. */
function pickPerson(scope: HTMLElement, label: string, name: string) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value: name.split(' ')[0] } });
  fireEvent.click(within(within(scope).getByRole('listbox', { name: `${label}: matches` })).getByText(name));
}

const protections = () => screen.getByRole('complementary', { name: 'Protections' });

async function searchFor(term: string) {
  fireEvent.change(screen.getByLabelText('Search columns'), { target: { value: term } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText('base_salary');
}

describe('ColumnAccessView', () => {
  it('lists the protections first; the first is open with its columns and who can see it', async () => {
    fakeApi();
    renderPage();
    await screen.findByText('salary_amount');
    const list = protections();
    expect(within(list).getByText('Salary')).toBeTruthy();
    expect(within(list).getByText('Contact details')).toBeTruthy();
    expect(within(list).getByText('Can see: Payroll team (1)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Salary/ })).toBeTruthy();
    expect(screen.queryByText('email')).toBeNull(); // belongs to Contact details
    expect(screen.getByText(/curated\.finance/)).toBeTruthy();
  });

  it('picking another protection shows its columns', async () => {
    fakeApi();
    renderPage();
    await screen.findByText('salary_amount');
    fireEvent.click(within(protections()).getByText('Contact details'));
    expect(await screen.findByText('email')).toBeTruthy();
    expect(screen.queryByText('salary_amount')).toBeNull();
    expect(screen.getByRole('heading', { name: /Contact details/ })).toBeTruthy();
    expect(screen.getByText(/1 Protected column/)).toBeTruthy();
    expect(screen.getAllByText(/Can see: nobody yet/).length).toBeGreaterThan(0);
  });

  it('add columns: search, tick, reason → tags each table once for the open protection', async () => {
    const calls = fakeApi();
    renderPage();
    await screen.findByText('salary_amount');
    await searchFor('salary');
    expect(screen.getByText('already in Salary')).toBeTruthy();
    expect(screen.getByText('also Contact details')).toBeTruthy();
    fireEvent.click(screen.getByText('Select all 2'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Pay data is need-to-know' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 columns to Salary' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/access/column-tags')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual(
      expect.arrayContaining([
        { tablePath: 'curated.hr.payroll', columns: ['base_salary'], tagId: 't1', reason: 'Pay data is need-to-know' },
        { tablePath: 'scratch.hr.v_costs', columns: ['salary_total'], tagId: 't1', reason: 'Pay data is need-to-know' },
      ]),
    );
    expect(await screen.findByText('2 columns added to Salary.')).toBeTruthy();
  });

  it('adding needs a reason', async () => {
    const calls = fakeApi();
    renderPage();
    await screen.findByText('salary_amount');
    await searchFor('salary');
    fireEvent.click(screen.getByLabelText('Select base_salary in curated.hr.payroll'));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 column to Salary' }));
    expect(await screen.findByText('Give a reason (at least 5 characters)')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('New protection with specific people creates it and opens it', async () => {
    const calls = fakeApi();
    renderPage();
    await screen.findByText('salary_amount');
    fireEvent.click(screen.getByRole('button', { name: 'New protection' }));
    const dialog = await screen.findByRole('dialog', { name: 'New protection' });
    fireEvent.change(within(dialog).getByLabelText('Data name'), { target: { value: 'Bonus' } });
    pickPerson(dialog, 'People', 'Ana Rao');
    pickPerson(dialog, 'People', 'Ben Ko');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Bonus is need-to-know' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/access/tag-grants')).toHaveLength(2));
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
    expect(writes).toEqual(['POST /api/access/tags', 'POST /api/access/tag-grants', 'POST /api/access/tag-grants']);
    const grantsPosted = calls.filter((c) => c.method === 'POST' && c.path === '/api/access/tag-grants').map((c) => c.body);
    expect(grantsPosted.map((b) => [b.principalType, b.principalId])).toEqual([
      ['user', 'u-ana'],
      ['user', 'u-ben'],
    ]);
    expect(await screen.findByText(/Created Bonus/)).toBeTruthy();
  });

  it('New protection with a new group: approver and people in one step', async () => {
    const calls = fakeApi();
    renderPage();
    await screen.findByText('salary_amount');
    fireEvent.click(screen.getByRole('button', { name: 'New protection' }));
    const dialog = await screen.findByRole('dialog', { name: 'New protection' });
    fireEvent.change(within(dialog).getByLabelText('Data name'), { target: { value: 'Bonus' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /A group/ }));
    fireEvent.change(within(dialog).getByLabelText('Group'), { target: { value: '__new_group__' } });
    fireEvent.change(within(dialog).getByLabelText('Group name'), { target: { value: 'HR leads' } });
    pickPerson(dialog, 'Approver', 'Olivia Owner');
    pickPerson(dialog, 'People in the group', 'Ben Ko');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Bonus is need-to-know' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/access/tag-grants')).toBe(true));
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
    expect(writes).toEqual(['POST /api/access/tags', 'POST /api/access/groups', 'POST /api/access/groups/grp-new/members', 'POST /api/access/tag-grants']);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/access/groups')!.body).toMatchObject({ name: 'HR leads', ownerIds: ['u-owner'] });
  });

  it('New protection: picking nobody, or a duplicate name, is refused before saving', async () => {
    const calls = fakeApi();
    renderPage();
    await screen.findByText('salary_amount');
    fireEvent.click(screen.getByRole('button', { name: 'New protection' }));
    const dialog = await screen.findByRole('dialog', { name: 'New protection' });
    fireEvent.change(within(dialog).getByLabelText('Data name'), { target: { value: 'Bonus' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Bonus is need-to-know' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('Pick at least one person')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Data name'), { target: { value: 'salary' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('“salary” already exists')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('remove from this protection deletes only its tag', async () => {
    const calls = fakeApi();
    renderPage();
    fireEvent.click(await screen.findByLabelText('Select salary_amount in curated.crew.contracts'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Salary' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stop protecting 1 column?' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Grade codes, not pay' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop protecting' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'DELETE')).toMatchObject({
        path: '/api/access/column-tags',
        body: { tablePath: 'curated.crew.contracts', column: 'salary_amount', tagId: 't1', reason: 'Grade codes, not pay' },
      }),
    );
  });

  it('move to another protection: adds the new one first, then removes this one', async () => {
    const calls = fakeApi();
    renderPage();
    fireEvent.click(await screen.findByLabelText('Select salary_amount in curated.crew.contracts'));
    fireEvent.click(screen.getByRole('button', { name: 'Move to another protection…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change who can see 1 column' });
    expect(within(dialog).queryByText('Can see: Payroll team (1)')).toBeNull(); // Salary is not offered again
    fireEvent.click(within(dialog).getByText('Contact details'));
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'It is a contact field' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
    expect(writes).toEqual(['POST /api/access/column-tags', 'DELETE /api/access/column-tags']);
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ columns: ['salary_amount'], tagId: 't2' });
    expect(calls.find((c) => c.method === 'DELETE')!.body).toMatchObject({ column: 'salary_amount', tagId: 't1' });
  });

  it('non-platform-admins can add columns but not create, remove or move', async () => {
    fakeApi();
    renderPage({ platformAdmin: false });
    await screen.findByText('salary_amount');
    expect(screen.queryByRole('button', { name: 'New protection' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByLabelText('Search columns')).toBeTruthy();
  });

  it('read-only viewers see protections and columns but no search or selection', async () => {
    fakeApi();
    renderPage({ readOnly: true, platformAdmin: false });
    await screen.findByText('salary_amount');
    expect(screen.queryByLabelText('Search columns')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('who can see: the approver can add people to the group', async () => {
    const calls = fakeApi();
    renderPage({ platformAdmin: false, readOnly: true, meId: 'u-owner' });
    await screen.findByText('salary_amount');
    fireEvent.click(screen.getByRole('button', { name: 'Who can see' }));
    const dialog = await screen.findByRole('dialog', { name: 'Who can see Salary' });
    expect(within(dialog).getByText('Ana Rao')).toBeTruthy();
    expect(within(dialog).getByText(/Approver: Olivia Owner/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Give access' })).toBeNull();
    fireEvent.click(within(dialog).getByText('Add people to Payroll team'));
    pickPerson(dialog, 'People to add', 'Ben Ko');
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Joined payroll' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/access/groups/grp1/members',
        body: { userId: 'u-ben', reason: 'Joined payroll' },
      }),
    );
  });

  it('who can see: a platform admin gives specific people access', async () => {
    const calls = fakeApi();
    renderPage();
    await screen.findByText('salary_amount');
    fireEvent.click(screen.getByRole('button', { name: 'Give access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Who can see Salary' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give access' }));
    pickPerson(dialog, 'People', 'Ben Ko');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Totals only' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'No end date' }));
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Budget planning' } });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Give access' }).at(-1)!);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/access/tag-grants',
        body: { tagId: 't1', principalType: 'user', principalId: 'u-ben', level: 'aggregate', expiresAt: null, reason: 'Budget planning' },
      }),
    );
  });

  it('nobody can pick themselves', async () => {
    fakeApi();
    renderPage({ meId: 'u-ben' });
    await screen.findByText('salary_amount');
    fireEvent.click(screen.getByRole('button', { name: 'Give access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Who can see Salary' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give access' }));
    fireEvent.change(within(dialog).getByLabelText('People'), { target: { value: 'Ben' } });
    expect(within(dialog).getByText('No one matches “Ben”.')).toBeTruthy();
  });
});
