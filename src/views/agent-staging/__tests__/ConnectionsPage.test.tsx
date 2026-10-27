// @vitest-environment jsdom
/**
 * Connections page against a fake /api/connections: add an S3 connection (saved then tested, private
 * unless shared), show the server's field errors, browse folders, and offer only use (not change) on
 * a connection someone else shared.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConnectionsPage from '../connections';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeApi(start: Record<string, unknown>[] = []) {
  const rows = [...start];
  const calls: { method: string; path: string; body?: any }[] = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://test');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    if (url.pathname === '/api/connections' && method === 'GET') return json(200, { connections: rows });
    if (url.pathname === '/api/connections' && method === 'POST') {
      if (body.config.bucket === 'Bad_Bucket') return json(422, { error: 'The connection settings are not valid', details: { issues: [{ path: 'bucket', message: 'must be a valid S3 bucket name' }] } });
      const row = { id: 'c1', name: body.name, kind: body.kind, config: body.config, visibility: body.visibility, mine: true, canManage: true, status: 'untested', lastTestedAt: null, lastError: null, updatedAt: new Date().toISOString() };
      rows.push(row);
      return json(201, { connection: row });
    }
    if (url.pathname.endsWith('/test')) {
      const row = { ...rows[0]!, status: 'ok' };
      rows[0] = row;
      return json(200, { ok: true, detail: 'Connected to s3://aloft-invoices/', connection: row });
    }
    if (url.pathname.endsWith('/browse')) {
      const path = url.searchParams.get('path');
      return json(200, path ? { path, items: [{ name: 'oct.pdf', path: '2026/oct.pdf', isFolder: false, size: 2048 }], truncated: false } : { path: '', items: [{ name: '2026', path: '2026', isFolder: true }], truncated: false });
    }
    return json(404, { error: 'not found' });
  });
  return calls;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('Connections page', () => {
  it('adds an S3 connection, sends credentials only in the create call, and tests it', async () => {
    const calls = fakeApi();
    render(<ConnectionsPage />);
    await screen.findByText('No connections yet');
    fireEvent.click(screen.getByRole('button', { name: /Add connection/ }));
    fireEvent.click(screen.getByRole('button', { name: /Amazon S3/ }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Finance invoices' } });
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'ap-south-1' } });
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'aloft-invoices' } });
    fireEvent.change(screen.getByLabelText('Access key ID'), { target: { value: 'AKIAIOSFODNN7EXAMPLE' } });
    const secret = screen.getByLabelText('Secret access key') as HTMLInputElement;
    expect(secret.type).toBe('password');
    fireEvent.change(secret, { target: { value: 's3cr3t-value-0123456789' } });
    expect((screen.getByRole('radio', { name: /Only me/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Save and test/ }));

    await screen.findByText(/Connected to s3:\/\/aloft-invoices\//);
    const create = calls.find((c) => c.method === 'POST' && c.path === '/api/connections')!;
    expect(create.body).toEqual({ name: 'Finance invoices', kind: 's3', config: { region: 'ap-south-1', bucket: 'aloft-invoices' }, secret: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 's3cr3t-value-0123456789' }, visibility: 'private' });
    const row = within(screen.getByRole('list', { name: 'Your connections' })).getByText('Finance invoices').closest('li')!;
    expect(within(row).getByText('Connected')).toBeTruthy();
    expect(within(row).getByText('Only you')).toBeTruthy();
    expect(within(row).getByText('s3://aloft-invoices · ap-south-1')).toBeTruthy();
  });

  it('shows the server’s reason next to the field it is about', async () => {
    fakeApi();
    render(<ConnectionsPage />);
    await screen.findByText('No connections yet');
    fireEvent.click(screen.getByRole('button', { name: /Add connection/ }));
    fireEvent.click(screen.getByRole('button', { name: /Amazon S3/ }));
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'Bad_Bucket' } });
    fireEvent.click(screen.getByRole('button', { name: /Save and test/ }));
    await screen.findByText('must be a valid S3 bucket name');
    expect(screen.getByRole('alert').textContent).toContain('The connection settings are not valid');
  });

  it('browses into a folder', async () => {
    fakeApi([{ id: 'c1', name: 'Docs', kind: 'sharepoint', config: { siteUrl: 'https://contoso.sharepoint.com/sites/Finance', library: 'Invoices' }, status: 'ok', lastTestedAt: null, lastError: null, updatedAt: '' }]);
    render(<ConnectionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Browse Docs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Files in Docs' });
    fireEvent.click(await within(dialog).findByRole('button', { name: '2026' }));
    await within(dialog).findByText('oct.pdf');
    expect(within(dialog).getByText('2.0 KB')).toBeTruthy();
  });

  it('can share a new connection with the organisation', async () => {
    const calls = fakeApi();
    render(<ConnectionsPage />);
    await screen.findByText('No connections yet');
    fireEvent.click(screen.getByRole('button', { name: /Add connection/ }));
    fireEvent.click(screen.getByRole('button', { name: /Amazon S3/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Team bucket' } });
    fireEvent.click(screen.getByRole('radio', { name: /Everyone in my organisation/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save and test/ }));
    await screen.findByText('Shared');
    expect(calls.find((c) => c.method === 'POST')!.body.visibility).toBe('org');
  });

  it('lets anyone use a colleague’s shared connection but not change or delete it', async () => {
    fakeApi([
      { id: 'c1', name: 'Docs', kind: 'azure_blob', config: { accountName: 'aloftdocs', container: 'docs' }, visibility: 'org', ownerName: 'Ana Owner', mine: false, canManage: false, status: 'error', lastTestedAt: null, lastError: 'AuthorizationFailure', updatedAt: '' },
    ]);
    render(<ConnectionsPage />);
    await screen.findByText('aloftdocs / docs');
    const shared = screen.getByRole('list', { name: 'Shared with you' });
    expect(within(shared).getByText('Shared by Ana Owner')).toBeTruthy();
    expect(screen.getByText('AuthorizationFailure')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add connection/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test Docs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Browse Docs' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Docs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Docs' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Your connections' })).toBeNull();
  });
});
