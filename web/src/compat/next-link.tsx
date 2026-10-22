/**
 * `next/link` for the Vite UI, backed by React Router's <Link>.
 * (Measured: no caller passes prefetch / scroll / replace / legacyBehavior / passHref, but they are accepted
 * and mapped so new code written in the Next style keeps working.)
 */
import { forwardRef } from 'react';
import type { AnchorHTMLAttributes } from 'react';
import { Link as RouterLink } from 'react-router';

type UrlObject = {
  pathname?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  hash?: string;
};

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string | UrlObject;
  replace?: boolean;
  /** `false` keeps the scroll position. */
  scroll?: boolean;
  prefetch?: boolean | null;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
}

const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function formatUrl(href: string | UrlObject): string {
  if (typeof href === 'string') return href;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(href.query ?? {})) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  const hash = href.hash ? (href.hash.startsWith('#') ? href.hash : `#${href.hash}`) : '';
  return `${href.pathname ?? ''}${qs ? `?${qs}` : ''}${hash}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, replace, scroll, prefetch: _prefetch, shallow: _shallow, passHref: _passHref, legacyBehavior: _legacy, children, ...rest },
  ref,
) {
  const to = formatUrl(href);
  // External URLs, in-page anchors and new-tab links are plain anchors, as in Next.
  if (EXTERNAL.test(to) || to.startsWith('#') || rest.target === '_blank') {
    return (
      <a ref={ref} href={to} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <RouterLink ref={ref} to={to} replace={replace} preventScrollReset={scroll === false} {...rest}>
      {children}
    </RouterLink>
  );
});

export default Link;
