import { useEffect, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSession = vi.fn();
vi.mock('next-auth/react', () => ({ useSession: () => useSession() }));

import { RequireAuth } from './RequireAuth';

function mount() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <div>LOGIN PAGE</div> },
      { element: <RequireAuth />, children: [{ path: '/secret', element: <div>SECRET CONTENT</div> }] },
    ],
    { initialEntries: ['/secret'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('RequireAuth (replaces getServerSession + redirect in (agent)/layout)', () => {
  beforeEach(() => useSession.mockReset());

  it('shows a loading state while the session is fetched, never the protected content', () => {
    useSession.mockReturnValue({ status: 'loading', data: undefined });
    mount();
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(screen.queryByText('SECRET CONTENT')).toBeNull();
  });

  it('redirects an unauthenticated user to /login and never renders the content', () => {
    useSession.mockReturnValue({ status: 'unauthenticated', data: null });
    const router = mount();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy();
    expect(screen.queryByText('SECRET CONTENT')).toBeNull();
  });

  it('does NOT unmount the app when next-auth flips back to loading during update() (regression: infinite remount loop)', () => {
    let mounts = 0;
    let force!: () => void;
    function Child() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <div>SECRET CONTENT</div>;
    }
    // A fresh <RequireAuth/> element on every render, so React cannot skip re-rendering it.
    function Harness() {
      const [, setN] = useState(0);
      force = () => setN((n) => n + 1);
      return <RequireAuth />;
    }
    useSession.mockReturnValue({ status: 'authenticated', data: { user: { id: 'u1' } } });
    const router = createMemoryRouter([{ element: <Harness />, children: [{ path: '/secret', element: <Child /> }] }], {
      initialEntries: ['/secret'],
    });
    render(<RouterProvider router={router} />);
    expect(mounts).toBe(1);

    // update() sets status to 'loading' while it runs, and the content must stay on screen…
    useSession.mockReturnValue({ status: 'loading', data: undefined });
    act(() => force());
    expect(screen.getByText('SECRET CONTENT')).toBeTruthy();

    // …and when it finishes, the child was never remounted (UserMenu would re-call update() if it were).
    useSession.mockReturnValue({ status: 'authenticated', data: { user: { id: 'u1' } } });
    act(() => force());
    expect(mounts).toBe(1);
  });

  it('renders the protected route for an authenticated user', () => {
    useSession.mockReturnValue({ status: 'authenticated', data: { user: { id: 'u1' } } });
    mount();
    expect(screen.getByText('SECRET CONTENT')).toBeTruthy();
  });
});
