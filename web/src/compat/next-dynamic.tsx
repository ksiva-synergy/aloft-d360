/**
 * `next/dynamic` for the Vite UI: React.lazy + Suspense. `{ ssr: false }` is a no-op (there is no SSR here).
 * Accepts loaders that resolve to a component or to a module with a `default` export, like Next's.
 */
import { createElement, lazy, Suspense } from 'react';
import type { ComponentType, ReactNode } from 'react';

type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };

export interface DynamicOptions {
  ssr?: boolean;
  loading?: ComponentType<unknown> | (() => ReactNode);
}

export default function dynamic<P extends object = Record<string, never>>(
  loader: () => Promise<Loaded<P>>,
  options: DynamicOptions = {},
): ComponentType<P> {
  const LazyComponent = lazy(async () => {
    const mod = await loader();
    const hasDefault = typeof mod === 'object' && mod !== null && 'default' in mod;
    return (hasDefault ? mod : { default: mod }) as { default: ComponentType<P> };
  });
  const Loading = options.loading as ComponentType<unknown> | undefined;

  function Dynamic(props: P) {
    return createElement(
      Suspense,
      { fallback: Loading ? createElement(Loading) : null },
      createElement(LazyComponent as ComponentType<Record<string, unknown>>, props as Record<string, unknown>),
    );
  }
  return Dynamic;
}
