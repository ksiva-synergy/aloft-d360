// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineConnectionCreate } from '../InlineConnectionCreate';

afterEach(() => vi.restoreAllMocks());

describe('InlineConnectionCreate', () => {
  it('saves S3 settings, runs a connection test, then selects the connection on success', async () => {
    const onCreated = vi.fn();
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/connections' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.kind).toBe('s3');
        expect(body.config.bucket).toBe('crew-bucket');
        return new Response(JSON.stringify({ connection: { id: 'conn-new', name: body.name, kind: 's3', status: 'untested' } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/conn-new/test') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ ok: true, detail: 'Connected to s3://crew-bucket/', connection: { id: 'conn-new', name: 'Crew docs', kind: 's3', status: 'ok' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    render(<InlineConnectionCreate preferredKind="s3" onCreated={onCreated} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Crew docs' } });
    fireEvent.change(screen.getByLabelText(/^Region$/i), { target: { value: 'ap-south-1' } });
    fireEvent.change(screen.getByLabelText(/^Bucket$/i), { target: { value: 'crew-bucket' } });
    fireEvent.change(screen.getByLabelText(/Access key ID/i), { target: { value: 'AKIA1234567890ABCD' } });
    fireEvent.change(screen.getByLabelText(/Secret access key/i), { target: { value: 'super-secret-key-here' } });
    fireEvent.click(screen.getByRole('button', { name: /Save and test/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'conn-new', status: 'ok' })));
    expect(screen.getByRole('status')).toHaveTextContent(/Connected to s3/i);
  });
});
