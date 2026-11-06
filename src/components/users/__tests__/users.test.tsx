// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import UsersPage from '@/views/agent-staging/users';
import { InviteUserModal } from '../InviteUserModal';
import { UserDetailDrawer } from '../UserDetailDrawer';
import { UserTable, type UserRow } from '../UserTable';

const session = vi.hoisted(() => ({ role: 'platform_admin' }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'self', role: session.role } } }),
}));
// Section levels from the real rules for the test's role (the hook itself fetches /api/me/sections).
vi.mock('@/lib/sections/useSectionLevels', async () => {
  const { resolveSectionLevels } = await import('@/lib/sections/registry');
  const me = () => ({ role: session.role, platformAdmin: session.role === 'platform_admin', levels: resolveSectionLevels([session.role], []) });
  return { useSectionLevels: me, useSectionLevel: (id: string) => me().levels[id] ?? 'none' };
});
// The drawer's "Open in Data access" link needs a router; a plain anchor is enough here.
vi.mock('@/lib/navigation/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const users: UserRow[] = [
  {
    id: 'self', name: 'Alex Morgan', email: 'alex@example.test', status: 'ACTIVE',
    authProvider: 'aad', lastLoginAt: '2026-10-30T10:00:00Z', createdAt: '2026-10-01T10:00:00Z',
    primaryRole: 'platform_admin', roleLabel: 'Platform admin', roles: [],
    logins7d: 2, logins30d: 8, sessions7d: 1, sessions30d: 4, agentChats: 3,
  },
  {
    id: 'other', name: 'Jamie Chen', email: 'jamie@example.test', status: 'SUSPENDED',
    authProvider: 'credentials', lastLoginAt: null, createdAt: '2026-10-02T10:00:00Z',
    primaryRole: 'member', roleLabel: 'Member', roles: [],
  },
];

async function sectionMatrix() {
  const { SECTIONS, SECTION_GROUP_LABEL, bundleCeiling } = await import('@/lib/sections/registry');
  return {
    canEdit: session.role === 'platform_admin',
    groups: SECTION_GROUP_LABEL,
    sections: SECTIONS.map((x) => ({
      id: x.id, label: x.label, group: x.group, view: x.view, manage: x.manage, defaults: x.defaults,
      viewOnly: Boolean(x.viewOnly), platformAdminActionsOnly: Boolean(x.manageIsPlatformAdminOnly),
      enforced: Boolean(x.enforced), bundleCeiling: bundleCeiling(x),
    })),
    bundles: [
      { id: 'r1', name: 'Analyst', description: null, kind: 'role', base: 'member', levels: { 'build.inspector': 'manage', 'govern.connections': 'view' }, members: [] },
      { id: 'b1', name: 'Cost viewers', description: null, kind: 'bundle', base: null, levels: { 'govern.cost': 'view' }, members: [{ id: 'other', name: 'Jamie Chen', email: 'jamie@example.test' }] },
    ],
  };
}

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => {
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

async function selectOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option, exact: true }));
}

beforeEach(() => {
  session.role = 'platform_admin';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/access/roles') return json({ roles: ['platform_admin', 'admin', 'member', 'readonly'].map(name => ({ id: name, name, permissions: [] })) });
    if (url === '/api/users' && !init?.method) return json({ users });
    if (url === '/api/sections') return json(await sectionMatrix());
    // The drawer's warehouse data access block is covered by its own tests; here it shows its error state.
    if (url.startsWith('/api/access/')) return json({ error: 'FORBIDDEN', message: 'Not in this test' }, 403);
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('Users directory', () => {
  it('combines search, role, and status filters and clears them', async () => {
    render(<UsersPage />);
    await screen.findByRole('button', { name: 'View profile for Alex Morgan' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search users' }), { target: { value: 'jamie@' } });
    await selectOption('Filter by role', 'Member');
    await selectOption('Filter by status', 'Suspended');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 2 users');
    expect(screen.queryByRole('button', { name: 'View profile for Alex Morgan' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 of 2 users');
  });

  it('shows an empty state and keeps the filters usable', async () => {
    render(<UsersPage />);
    await screen.findByRole('button', { name: 'View profile for Alex Morgan' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search users' }), { target: { value: 'missing' } });
    expect(screen.getByText('No users found')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Showing 0 of 2 users');
  });

  it('surfaces load errors and retries without showing a misleading empty directory', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    render(<UsersPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load users');
    expect(screen.queryByText('No users found')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'View profile for Alex Morgan' })).toBeInTheDocument();
  });

  it('opens profiles from the keyboard, traps focus, and restores it on Escape', async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    const trigger = await screen.findByRole('button', { name: 'View profile for Alex Morgan' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'User profile' });
    const close = within(dialog).getByRole('button', { name: 'Close user profile' });
    await waitFor(() => expect(close).toHaveFocus());
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(within(dialog).getByRole('button', { name: 'Change Role' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('preserves status updates from the profile', async () => {
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View profile for Jamie Chen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unblock User' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/users/other', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Block User' })).toBeInTheDocument());
  });

  it('updates roles through the redesigned role picker', async () => {
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View profile for Jamie Chen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change Role' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change role' });
    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: 'New role' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /^Admin/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Update Role' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/users/other', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'admin' }) })));
    await screen.findByText('Role updated successfully');
  });

  it('hides administrative actions for members and self-destructive actions for the current user', async () => {
    session.role = 'member';
    const { unmount } = render(<UsersPage />);
    await screen.findByRole('button', { name: 'View profile for Alex Morgan' });
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    unmount();
    render(<UserDetailDrawer user={users[0]} open currentUserId="self" canUpdateUsers canDeleteUsers onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Block User' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove User' })).not.toBeInTheDocument();
  });

  it('edits a bundle in the section access matrix and saves only on Save', async () => {
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Section access' }));
    const cost = await screen.findByRole('combobox', { name: 'Cost viewers: Cost monitor' });
    expect(cost).toHaveValue('view');
    // Data Estate actions stay with platform admins: Manage cannot be picked for a bundle.
    const jobs = screen.getByRole('combobox', { name: 'Cost viewers: Jobs' });
    expect(within(jobs).getByRole('option', { name: 'Manage (not allowed)' })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Cost viewers: Policies' }), { target: { value: 'view' } });
    expect(screen.getByText('Unsaved changes in 1 bundle')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/sections/bundles/b1', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sections/bundles/b1', expect.objectContaining({ method: 'PATCH' })));
    const sent = JSON.parse(fetchMock.mock.calls.find(([u]) => u === '/api/sections/bundles/b1')![1].body as string);
    expect(sent.levels['govern.policies']).toBe('view');
    expect(sent.levels['govern.cost']).toBe('view');
    expect(sent.levels['govern.users']).toBe('none');
  });

  it('shows custom roles and bundles as separate kinds of column', async () => {
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Section access' }));
    expect(await screen.findByText('Role · from Member')).toBeInTheDocument();
    expect(screen.getByText('Bundle · adds')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New role' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New bundle' })).toBeInTheDocument();
  });

  it("sets one person's custom role and bundles from their profile", async () => {
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View profile for Jamie Chen' }));
    const select = await screen.findByLabelText('Custom role');
    fireEvent.change(select, { target: { value: 'r1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cost viewers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save section access' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/users/other/section-access', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ customRoleId: 'r1', bundleIds: ['b1'] }) })),
    );
  });

  it('shows the matrix read-only to admins', async () => {
    session.role = 'admin';
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Section access' }));
    await screen.findByText('Cost viewers');
    expect(screen.queryByRole('combobox', { name: 'Cost viewers: Cost monitor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New bundle' })).not.toBeInTheDocument();
  });

  it('keeps contribution metrics and renders action menus outside the scrolling table', () => {
    const onChangeRole = vi.fn();
    const { container } = render(<UserTable users={users} canAssignRoles onChangeRole={onChangeRole} />);
    expect(screen.getByTitle('0 inspector chats · 3 agent chats · 0 memories')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Jamie Chen' }));
    const action = screen.getByRole('button', { name: 'Change Role' });
    expect(container.contains(action)).toBe(false);
    fireEvent.click(action);
    expect(onChangeRole).toHaveBeenCalledWith(users[1]);
  });
});

describe('Invite user', () => {
  it('moves focus into the mounted dialog and restores it when closed', async () => {
    const user = userEvent.setup();
    render(<UsersPage />);
    const trigger = screen.getByRole('button', { name: 'Invite user' });
    await user.click(trigger);
    const close = await screen.findByRole('button', { name: 'Close invite dialog' });
    await waitFor(() => expect(close).toHaveFocus());
    await user.click(close);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('creates an SSO user without a password and uses the selected default role', async () => {
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    render(<InviteUserModal open onOpenChange={onOpenChange} onSuccess={onSuccess} />);
    await screen.findByRole('combobox', { name: /Role/ });
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'New@Example.test' } });
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: ' New User ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'new@example.test', roles: ['member'], name: 'New User' }) }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('supports optional password sign-in and displays API errors', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/access/roles'
      ? json({ roles: [{ id: 'member', name: 'member', permissions: [] }] })
      : json({ error: 'Email already exists' }, 409));
    render(<InviteUserModal open onOpenChange={vi.fn()} />);
    await screen.findByRole('combobox', { name: /Role/ });
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'new@example.test' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'test-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already exists');
    expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ body: JSON.stringify({ email: 'new@example.test', roles: ['member'], password: 'test-password-123' }) }));
  });

  it('blocks submission when role loading fails rather than inventing available roles', async () => {
    fetchMock.mockResolvedValue(json({}, 503));
    render(<InviteUserModal open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load available roles');
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'new@example.test' } });
    expect(screen.getByRole('button', { name: 'Create user' })).toBeDisabled();
  });
});
