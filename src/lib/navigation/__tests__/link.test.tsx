// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import Link, { formatUrl } from '../link';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
}

function mount(ui: React.ReactNode) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <Where />
            {ui}
          </>
        ),
      },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('next/link shim', () => {
  it('renders a real anchor with the href and passes className/aria through', () => {
    mount(
      <Link href="/agent-lab/history" className="x" aria-label="hist">
        History
      </Link>,
    );
    const a = screen.getByRole('link', { name: 'hist' });
    expect(a.getAttribute('href')).toBe('/agent-lab/history');
    expect(a.className).toBe('x');
    expect(a.textContent).toBe('History');
  });

  it('navigates client-side (the router location changes)', async () => {
    const router = mount(<Link href="/docs/agents">go</Link>);
    await act(async () => screen.getByText('go').click());
    expect(router.state.location.pathname).toBe('/docs/agents');
  });

  it('honours replace', async () => {
    const router = mount(
      <Link href="/a" replace>
        a
      </Link>,
    );
    await act(async () => screen.getByText('a').click());
    expect(router.state.location.pathname).toBe('/a');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('accepts Next-only props without leaking them to the DOM', () => {
    mount(
      <Link href="/p" prefetch={false} scroll={false} shallow passHref legacyBehavior={false}>
        p
      </Link>,
    );
    const a = screen.getByText('p');
    for (const attr of ['prefetch', 'shallow', 'passhref', 'legacybehavior', 'scroll']) expect(a.hasAttribute(attr)).toBe(false);
  });

  it('external, mailto, hash and target=_blank links are plain anchors the router does not handle', async () => {
    mount(
      <>
        <Link href="https://example.com/x">ext</Link>
        <Link href="mailto:a@b.c">mail</Link>
        <Link href="#section">hash</Link>
        <Link href="/new-tab" target="_blank">
          tab
        </Link>
      </>,
    );
    expect(screen.getByText('ext').getAttribute('href')).toBe('https://example.com/x');
    expect(screen.getByText('mail').getAttribute('href')).toBe('mailto:a@b.c');
    expect(screen.getByText('hash').getAttribute('href')).toBe('#section');
    await act(async () => screen.getByText('tab').click());
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('formats object hrefs (pathname + query + hash)', () => {
    expect(formatUrl({ pathname: '/s', query: { q: 'a b', n: 2, skip: undefined, nul: null } })).toBe('/s?q=a+b&n=2');
    expect(formatUrl({ pathname: '/s', hash: 'top' })).toBe('/s#top');
    expect(formatUrl('/plain')).toBe('/plain');
  });
});
