// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StreamingMessage } from './StreamingMessage';

vi.mock('@/components/companion/CaptainStatus', () => ({
  CaptainStatus: () => <div>Companion status</div>,
}));
vi.mock('./ResponseLoading', () => ({ ResponseLoading: () => <div>Loading response</div> }));

describe('clean chat presentation', () => {
  it('keeps the answer and copy action visible with metadata collapsed', async () => {
    render(<StreamingMessage cleanPresentation content="The purchase order total is **296,225**." isStreaming={false} tokenCount={1200} />);
    await waitFor(() => expect(screen.getByText('296,225')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible();
    expect(screen.getByText('Details').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('Companion status')).not.toBeInTheDocument();
  });

  it('retains error feedback on a completed answer', async () => {
    render(<StreamingMessage cleanPresentation content="Partial result" isStreaming={false} error="The data source is unavailable." />);
    expect(screen.getByRole('alert')).toHaveTextContent('The data source is unavailable.');
    await waitFor(() => expect(screen.getByText('Companion status')).toBeVisible());
  });

  it('retains the compact loader before answer text arrives', async () => {
    render(<StreamingMessage cleanPresentation content="" isStreaming />);
    await waitFor(() => expect(screen.getByText('Loading response')).toBeVisible());
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
  });
});
