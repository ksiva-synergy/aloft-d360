/**
 * App navigation hooks, backed by React Router v7 (Data mode). The API mirrors the old `next/navigation`
 * (useRouter push/replace/back/refresh, usePathname, useSearchParams, useParams) so call sites stay unchanged.
 */
import { useMemo } from 'react';
import { useLocation, useNavigate, useParams as useRRParams, useRevalidator } from 'react-router';

export interface NavigateOptions {
  /** `false` keeps the scroll position (Next: `{ scroll: false }`). */
  scroll?: boolean;
}

export interface AppRouterInstance {
  push(href: string, options?: NavigateOptions): void;
  replace(href: string, options?: NavigateOptions): void;
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch(href: string): void;
}

const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function useRouter(): AppRouterInstance {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const revalidate = revalidator.revalidate;
  return useMemo<AppRouterInstance>(
    () => ({
      push: (href, options) => {
        if (EXTERNAL.test(href)) window.location.assign(href);
        else void navigate(href, { preventScrollReset: options?.scroll === false });
      },
      replace: (href, options) => {
        if (EXTERNAL.test(href)) window.location.replace(href);
        else void navigate(href, { replace: true, preventScrollReset: options?.scroll === false });
      },
      back: () => void navigate(-1),
      forward: () => void navigate(1),
      // Next re-runs server components. There are none here; re-run route loaders (if any).
      refresh: () => void revalidate(),
      prefetch: () => {},
    }),
    [navigate, revalidate],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

/** Same shape as Next's: immutable. Mutating calls throw so a bug surfaces the way it does in Next. */
export class ReadonlyURLSearchParams extends URLSearchParams {
  append(): never {
    throw new Error('Method unavailable on `ReadonlyURLSearchParams`.');
  }
  delete(): never {
    throw new Error('Method unavailable on `ReadonlyURLSearchParams`.');
  }
  set(): never {
    throw new Error('Method unavailable on `ReadonlyURLSearchParams`.');
  }
  sort(): never {
    throw new Error('Method unavailable on `ReadonlyURLSearchParams`.');
  }
}

export function useSearchParams(): ReadonlyURLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new ReadonlyURLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T {
  return useRRParams() as unknown as T;
}
