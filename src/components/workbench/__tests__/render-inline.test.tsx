// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantContent } from '@/components/workbench/StreamingMessage';

describe('render-inline links', () => {
  it('renders markdown links in prose as clickable labels', () => {
    render(
      <AssistantContent
        content={'[Open the SIRE report PDF](https://assets.example.com/report.pdf)'}
      />,
    );
    const link = screen.getByRole('link', { name: 'Open the SIRE report PDF' });
    expect(link).toHaveAttribute('href', 'https://assets.example.com/report.pdf');
    expect(screen.queryByText(/assets\.example/)).not.toBeInTheDocument();
  });

  it('hides long URLs in table cells and offers copy link', async () => {
    const url = 'https://assets.example.com/SIRE_Report/9610250/long-name.pdf';
    render(
      <AssistantContent
        content={`| Report | Link |\n| --- | --- |\n| SIRE | [Open PDF](${url}) |`}
      />,
    );
    const link = screen.getByRole('link', { name: 'Open PDF' });
    expect(link).toHaveAttribute('href', url);
    expect(screen.queryByText(url)).not.toBeInTheDocument();
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(url));
  });
});
