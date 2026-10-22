import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import dynamic from './next-dynamic';

describe('next/dynamic shim', () => {
  it('lazy-loads a module with a default export and forwards props', async () => {
    const Comp = dynamic<{ label: string }>(() => Promise.resolve({ default: ({ label }) => <b>{label}</b> }), { ssr: false });
    render(<Comp label="hello" />);
    expect(await screen.findByText('hello')).toBeTruthy();
  });

  it('accepts a loader that resolves straight to a component', async () => {
    const Inner = ({ n }: { n: number }) => <i>n={n}</i>;
    const Comp = dynamic<{ n: number }>(() => Promise.resolve(Inner));
    render(<Comp n={7} />);
    expect(await screen.findByText('n=7')).toBeTruthy();
  });

  it('shows the loading component while the chunk is pending', async () => {
    let resolve!: (m: { default: () => JSX.Element }) => void;
    const pending = new Promise<{ default: () => JSX.Element }>((r) => (resolve = r));
    const Comp = dynamic(() => pending, { loading: () => <span>loading…</span> });
    render(<Comp />);
    expect(screen.getByText('loading…')).toBeTruthy();
    resolve({ default: () => <span>ready</span> });
    expect(await screen.findByText('ready')).toBeTruthy();
  });
});
