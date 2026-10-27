import { useEffect, useState } from 'react';

export type JsonState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; httpStatus?: number };

/** Minimal GET-JSON hook for the few pages that used to load data on the server. Same-origin cookies, abortable. */
export function useJson<T>(url: string | null): JsonState<T> {
  const [state, setState] = useState<JsonState<T>>({ status: 'loading' });

  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    setState({ status: 'loading' });
    fetch(url, { signal: ac.signal, credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) {
          setState({ status: 'error', httpStatus: res.status });
          return;
        }
        setState({ status: 'ok', data: (await res.json()) as T });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') setState({ status: 'error' });
      });
    return () => ac.abort();
  }, [url]);

  return state;
}
