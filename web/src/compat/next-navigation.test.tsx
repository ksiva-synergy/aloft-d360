import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { notFound, ReadonlyURLSearchParams, redirect, useParams, usePathname, useRouter, useSearchParams } from './next-navigation';

function Probe() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useParams<{ id: string }>();
  const loc = useLocation();
  return (
    <div>
      <output data-testid="path">{pathname}</output>
      <output data-testid="loc">{loc.pathname + loc.search}</output>
      <output data-testid="q">{search.get('q') ?? 'none'}</output>
      <output data-testid="id">{params.id ?? 'noid'}</output>
      <button onClick={() => router.push('/next?q=1')}>push</button>
      <button onClick={() => router.replace('/replaced?q=2')}>replace</button>
      <button onClick={() => router.back()}>back</button>
      <button onClick={() => router.refresh()}>refresh</button>
      <button onClick={() => router.push('/keep', { scroll: false })}>noscroll</button>
    </div>
  );
}

function mount(initial = '/start?q=0') {
  const router = createMemoryRouter(
    [
      { path: '/item/:id', element: <Probe /> },
      { path: '*', element: <Probe /> },
    ],
    { initialEntries: [initial] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('next/navigation shim', () => {
  it('usePathname / useSearchParams / useParams read the current route', () => {
    mount('/item/42?q=hello');
    expect(screen.getByTestId('path').textContent).toBe('/item/42');
    expect(screen.getByTestId('q').textContent).toBe('hello');
    expect(screen.getByTestId('id').textContent).toBe('42');
  });

  it('router.push navigates and keeps history; back returns', async () => {
    const router = mount('/start?q=0');
    await act(async () => screen.getByText('push').click());
    expect(router.state.location.pathname + router.state.location.search).toBe('/next?q=1');
    expect(screen.getByTestId('q').textContent).toBe('1');
    await act(async () => screen.getByText('back').click());
    expect(router.state.location.pathname).toBe('/start');
  });

  it('router.replace swaps the entry instead of adding one', async () => {
    const router = mount('/start?q=0');
    await act(async () => screen.getByText('replace').click());
    expect(router.state.location.pathname).toBe('/replaced');
    await act(async () => screen.getByText('back').click());
    // nothing before /start in the memory history, so back leaves us on the replaced entry
    expect(router.state.location.pathname).toBe('/replaced');
  });

  it('router.push with { scroll: false } still navigates', async () => {
    const router = mount();
    await act(async () => screen.getByText('noscroll').click());
    expect(router.state.location.pathname).toBe('/keep');
  });

  it('router.refresh does not throw inside a data router', async () => {
    mount();
    await act(async () => screen.getByText('refresh').click());
    expect(screen.getByTestId('path').textContent).toBe('/start');
  });

  it('external URLs leave the SPA via window.location', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, replace: vi.fn() } });
    function Ext() {
      const r = useRouter();
      return <button onClick={() => r.push('https://example.com/x')}>go</button>;
    }
    const router = createMemoryRouter([{ path: '*', element: <Ext /> }], { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    await act(async () => screen.getByText('go').click());
    expect(assign).toHaveBeenCalledWith('https://example.com/x');
    expect(router.state.location.pathname).toBe('/');
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  it('ReadonlyURLSearchParams reads like URLSearchParams but rejects mutation (as in Next)', () => {
    const p = new ReadonlyURLSearchParams('a=1&b=2');
    expect(p.get('a')).toBe('1');
    expect(p.toString()).toBe('a=1&b=2');
    expect(new URLSearchParams(p.toString()).get('b')).toBe('2');
    expect(() => p.set()).toThrow();
    expect(() => p.append()).toThrow();
    expect(() => p.delete()).toThrow();
  });

  it('notFound throws a 404 Response; redirect throws a redirect Response', () => {
    let nf: unknown;
    try {
      notFound();
    } catch (e) {
      nf = e;
    }
    expect(nf).toBeInstanceOf(Response);
    expect((nf as Response).status).toBe(404);
    let rd: unknown;
    try {
      redirect('/login');
    } catch (e) {
      rd = e;
    }
    expect((rd as Response).headers.get('Location')).toBe('/login');
  });
});
